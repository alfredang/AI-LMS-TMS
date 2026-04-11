import pool from '../db';
import { buildTmsInvoiceNo } from '../utils/tmsInvoiceNo';
import { isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';
import { refreshGrantsForEnrolments, upsertSsgEnrolmentFromLocalEnrollment } from './billingSync';
import { uploadInvoicePdfToDrive } from './invoiceDriveUpload';
import {
  qboCreateInvoice,
  qboFetchInvoicePdf,
  qboFindItemBySku,
  qboFindOrCreateCustomerByEmail,
  qboResolveInvoiceLineTaxCodeRef,
  qboSendInvoice,
} from './qboInvoiceService';

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

async function step<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const inner = e instanceof Error ? e.message : String(e);
    throw new Error(`${phase}: ${inner}`);
  }
}

async function getLearnerDisplayName(userId: string, fallbackEmail: string): Promise<string> {
  const r = await pool.query(`SELECT full_name FROM app_user WHERE id = $1 LIMIT 1`, [userId]);
  return (r.rows[0]?.full_name || '').trim() || fallbackEmail;
}

/** Reserve a unique TMS invoice number on the job row before QBO create (DocNumber). */
async function reserveTmsInvoiceNo(jobId: string, enrolmentId: string, existing: string | null | undefined): Promise<string> {
  const trimmed = (existing || '').trim();
  if (trimmed) return trimmed;
  const now = new Date();
  for (let salt = 0; salt < 100; salt++) {
    const candidate = buildTmsInvoiceNo(enrolmentId, now, salt);
    const taken = await pool.query(
      `SELECT 1 FROM public.invoice_jobs WHERE invoice_no = $1 AND id <> $2::uuid LIMIT 1`,
      [candidate, jobId]
    );
    if (taken.rows.length > 0) continue;
    try {
      await pool.query(
        `UPDATE public.invoice_jobs SET invoice_no = $1, updated_at = now() WHERE id = $2::uuid`,
        [candidate, jobId]
      );
      return candidate;
    } catch (e: unknown) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === '23505') continue;
      throw e;
    }
  }
  throw new Error('Could not allocate unique TMS invoice number');
}

export async function processInvoiceJob(jobId: string): Promise<void> {
  // Load job
  const jobRes = await pool.query(`SELECT * FROM public.invoice_jobs WHERE id = $1 LIMIT 1`, [jobId]);
  const job = jobRes.rows[0];
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') return;

  const enrolmentId: string = job.enrolment_id;
  const userId: string = job.user_id;
  const learnerEmail: string = job.learner_email;
  const courseCode: string = job.course_code;

  const enrRow = await pool.query(
    `SELECT enrolment_status FROM enrollment
     WHERE user_id = $1 AND LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($2::text))
     LIMIT 1`,
    [userId, enrolmentId]
  );
  const enrStatus = enrRow.rows[0]?.enrolment_status as string | undefined;
  if (!isEnrolmentEligibleForAutoInvoice(enrStatus)) {
    throw new Error(
      `Skipped: enrolment is not Confirmed (status: ${enrStatus || 'unknown'}). Invoice is not sent for cancelled or removed enrolments.`
    );
  }

  // 1) Best-effort grant refresh (continue even if Processing/failed)
  try {
    await refreshGrantsForEnrolments([enrolmentId]);
  } catch (e) {
    console.warn('[invoice-job] Grant refresh failed (non-blocking):', e);
  }

  // 2) Find QBO item by SKU (course code / ref)
  const item = await qboFindItemBySku(undefined, courseCode);
  if (!item) throw new Error(`QuickBooks item not found for SKU: ${courseCode}`);
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
    throw new Error(
      `QuickBooks item "${item.name}" (SKU ${courseCode}) has unit price ${item.unitPrice}. Set a positive Unit Price on the Item in QuickBooks.`
    );
  }

  // 3) Find/Create customer by learner email
  const displayName = await getLearnerDisplayName(userId, learnerEmail);
  const customerId = await qboFindOrCreateCustomerByEmail(undefined, learnerEmail, displayName);

  // 4) Create invoice (skip if a previous run created it but failed later — avoids duplicates)
  const taxCodeRef = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const lineDetail: Record<string, unknown> = {
    ItemRef: { value: item.id },
    Qty: 1,
    UnitPrice: item.unitPrice,
    TaxCodeRef: { value: taxCodeRef },
  };

  const gtc = process.env.QBO_INVOICE_GLOBAL_TAX_CALC?.trim();
  const invoiceBody: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: [
      {
        Amount: item.unitPrice,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: lineDetail,
        Description: `Course enrolment: ${courseCode} (SSG enrolment: ${enrolmentId})`,
      },
    ],
    BillEmail: { Address: learnerEmail },
    PrivateNote: `SSG enrolment: ${enrolmentId}`,
  };
  if (gtc && gtc.toLowerCase() !== 'omit') {
    invoiceBody.GlobalTaxCalculation = gtc;
  }

  let invoiceId: string = job.qbo_invoice_id ? String(job.qbo_invoice_id) : '';
  let docNumber: string | null = job.qbo_doc_number ?? null;
  let invoiceNo: string | null = job.invoice_no ? String(job.invoice_no).trim() || null : null;

  if (!invoiceId) {
    invoiceNo = await reserveTmsInvoiceNo(jobId, enrolmentId, invoiceNo);
    invoiceBody.DocNumber = invoiceNo;

    const inv = await step('QBO create invoice', () => qboCreateInvoice(undefined, invoiceBody));
    if (!inv.id) throw new Error('QBO create invoice: QuickBooks returned no Id');
    invoiceId = inv.id;
    docNumber = inv.docNumber ?? invoiceNo;
    await pool.query(
      `UPDATE public.invoice_jobs
       SET qbo_invoice_id = $2, qbo_doc_number = $3, invoice_no = COALESCE(invoice_no, $4), updated_at = now()
       WHERE id = $1`,
      [jobId, invoiceId, docNumber, invoiceNo]
    );
  }

  // 5) Send — use BillEmail on the invoice only (no sendTo query); optional ?sendTo often triggers Intuit NPE (10000).
  const skipSend = process.env.QBO_SKIP_SEND_INVOICE === '1' || process.env.QBO_SKIP_SEND_INVOICE === 'true';
  if (!skipSend) {
    await step('QBO send invoice', () => qboSendInvoice(undefined, invoiceId));
  }

  // 6) Download PDF
  const pdf = await step('QBO fetch invoice PDF', () => qboFetchInvoicePdf(undefined, invoiceId));

  // 7) Upload to Drive
  const fileName = `QBO_Invoice_${safeText(invoiceNo || docNumber || invoiceId)}_${safeText(enrolmentId)}.pdf`;
  const drive = await step('Google Drive upload', () => uploadInvoicePdfToDrive({ pdf, fileName }));

  try {
    await upsertSsgEnrolmentFromLocalEnrollment(enrolmentId);
  } catch (e) {
    console.warn('[invoice-job] ssg_enrolments upsert (non-blocking):', e);
  }

  // 8) Mark done with Drive links
  await pool.query(
    `UPDATE public.invoice_jobs
     SET status = 'done',
         drive_file_id = $2,
         drive_web_view_link = $3,
         updated_at = now()
     WHERE id = $1`,
    [jobId, drive.fileId, drive.webViewLink]
  );
}

