import pool from '../db';
import { buildTmsInvoiceNo } from '../utils/tmsInvoiceNo';
import { isEnrolmentBlockedFromAutoInvoice, isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';
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

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
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

  // Fetch all needed fields from da_application
  const daRes = await pool.query(
    `SELECT full_course_fee, gst, skillsfuture_subsidy, skillsfuture_credit,
            course_title, course_reference_number, course_start_date, course_end_date,
            trainee_name, trainee_id, course_run_id, grant_id,
            skillsfuture_credit_claim_id, application_id
     FROM da_application WHERE enrolment_id = $1 LIMIT 1`,
    [enrolmentId]
  );
  const da = daRes.rows[0] || {};

  const fullCourseFee = Number(da.full_course_fee) || 0;
  const gst = Number(da.gst) || 0;
  const grantSubsidy = Number(da.skillsfuture_subsidy) || 0;
  const sfcCredit = Number(da.skillsfuture_credit) || 0;

  console.log('[DA Application values]', {
    enrolmentId,
    full_course_fee: da.full_course_fee,
    gst: da.gst,
    skillsfuture_subsidy: da.skillsfuture_subsidy,
    skillsfuture_credit: da.skillsfuture_credit,
    course_title: da.course_title,
    trainee_name: da.trainee_name,
    grant_id: da.grant_id,
    application_id: da.application_id,
  });

  const enrRow = await pool.query(
    `SELECT enrolment_status FROM enrollment
     WHERE user_id = $1 AND LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($2::text))
     LIMIT 1`,
    [userId, enrolmentId]
  );
  const enrStatus = enrRow.rows[0]?.enrolment_status as string | undefined;

  const ssgStatusRow = await pool.query(
    `SELECT enrolment_status FROM ssg_enrolments
     WHERE LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($1::text))
     LIMIT 1`,
    [enrolmentId]
  );
  const ssgStatus = ssgStatusRow.rows[0]?.enrolment_status as string | undefined;

  if (isEnrolmentBlockedFromAutoInvoice(enrStatus) || isEnrolmentBlockedFromAutoInvoice(ssgStatus)) {
    throw new Error('Skipped: enrolment is cancelled or removed — invoice is not sent.');
  }
  if (!isEnrolmentEligibleForAutoInvoice(enrStatus) && !isEnrolmentEligibleForAutoInvoice(ssgStatus)) {
    throw new Error(
      `Skipped: enrolment is not Confirmed (local enrollment: ${enrStatus ?? '—'}, ssg_enrolments: ${ssgStatus ?? '—'}).`
    );
  }

  // 1) Best-effort grant refresh
  try {
    await refreshGrantsForEnrolments([enrolmentId]);
  } catch (e) {
    console.warn('[invoice-job] Grant refresh failed (non-blocking):', e);
  }

  // 2) Find QBO item by SKU
  const item = await qboFindItemBySku(undefined, courseCode);
  if (!item) throw new Error(`QuickBooks item not found for SKU: ${courseCode}`);
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
    throw new Error(
      `QuickBooks item "${item.name}" (SKU ${courseCode}) has unit price ${item.unitPrice}. Set a positive Unit Price on the Item in QuickBooks.`
    );
  }

  const actualFullCourseFee = fullCourseFee || item.unitPrice;

  // 3) Find/Create customer
  const displayName = await getLearnerDisplayName(userId, learnerEmail);
  const customerId = await qboFindOrCreateCustomerByEmail(undefined, learnerEmail, displayName);

  // 4) Build invoice lines
  const taxCodeRef = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const lines: any[] = [];

  // Line 1: Full course fee with rich description
  lines.push({
    Amount: actualFullCourseFee,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: {
      ItemRef: { value: item.id },
      Qty: 1,
      UnitPrice: actualFullCourseFee,
      TaxCodeRef: { value: taxCodeRef },
    },
    Description: [
      `Course Name: ${da.course_title ?? courseCode}`,
      `(${da.course_reference_number ?? courseCode})`,
      `Participant Name: ${da.trainee_name ?? displayName}`,
      `NRIC: ${da.trainee_id ?? '—'}`,
      `Course Date: ${formatDate(da.course_start_date)} - ${formatDate(da.course_end_date)}`,
      `Course Run: ${da.course_run_id ?? '—'}`,
    ].join('\n'),
  });

  // Line 2: WSQ Grant/subsidy deduction
  if (grantSubsidy > 0) {
    lines.push({
      Amount: -grantSubsidy,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: item.id },
        Qty: 1,
        UnitPrice: -grantSubsidy,
        TaxCodeRef: { value: taxCodeRef },
      },
      Description: `Less: WSQ funding (Baseline)\nGrant Ref#: ${da.grant_id ?? '—'}`,
    });
  }

  // Line 3: SkillsFuture Credit (always show, even if 0)
  lines.push({
    Amount: -sfcCredit,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: {
      ItemRef: { value: item.id },
      Qty: 1,
      UnitPrice: -sfcCredit,
      TaxCodeRef: { value: taxCodeRef },
    },
    Description: `SkillsFuture Credit Usage/Claim:\nApplication ID: ${da.application_id ?? '—'}`,
  });

  const gtc = process.env.QBO_INVOICE_GLOBAL_TAX_CALC?.trim();
  const invoiceBody: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: lines,
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

    let inv;
    try {
      inv = await step('QBO create invoice', () => qboCreateInvoice(undefined, invoiceBody));
    } catch (err) {
      if (err && typeof err === 'object') {
        console.error('[QBO create invoice error]', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      } else {
        console.error('[QBO create invoice error]', err);
      }
      throw err;
    }
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

  // 5) Send invoice
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

  // 8) Mark done
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