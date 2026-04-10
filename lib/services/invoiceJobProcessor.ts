import pool from '../db';
import { refreshGrantsForEnrolments } from './billingSync';
import { uploadInvoicePdfToDrive } from './invoiceDriveUpload';
import {
  qboCreateInvoice,
  qboFetchInvoicePdf,
  qboFindItemBySku,
  qboFindOrCreateCustomerByEmail,
  qboSendInvoice,
} from './qboInvoiceService';

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

async function getLearnerDisplayName(userId: string, fallbackEmail: string): Promise<string> {
  const r = await pool.query(`SELECT full_name FROM app_user WHERE id = $1 LIMIT 1`, [userId]);
  return (r.rows[0]?.full_name || '').trim() || fallbackEmail;
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

  // 1) Best-effort grant refresh (continue even if Processing/failed)
  try {
    await refreshGrantsForEnrolments([enrolmentId]);
  } catch (e) {
    console.warn('[invoice-job] Grant refresh failed (non-blocking):', e);
  }

  // 2) Find QBO item by SKU (course code / ref)
  const item = await qboFindItemBySku(undefined, courseCode);
  if (!item) throw new Error(`QuickBooks item not found for SKU: ${courseCode}`);

  // 3) Find/Create customer by learner email
  const displayName = await getLearnerDisplayName(userId, learnerEmail);
  const customerId = await qboFindOrCreateCustomerByEmail(undefined, learnerEmail, displayName);

  // 4) Create invoice
  const invoiceBody = {
    CustomerRef: { value: customerId },
    Line: [
      {
        Amount: item.unitPrice,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: item.id, name: item.name },
          Qty: 1,
          UnitPrice: item.unitPrice,
        },
        Description: `Course enrolment: ${courseCode} (SSG enrolment: ${enrolmentId})`,
      },
    ],
    BillEmail: { Address: learnerEmail },
    PrivateNote: `SSG enrolment: ${enrolmentId}`,
  };

  const inv = await qboCreateInvoice(undefined, invoiceBody);
  if (!inv.id) throw new Error('QuickBooks invoice create returned no Id');

  // Persist invoice IDs early (idempotency / audit)
  await pool.query(
    `UPDATE public.invoice_jobs
     SET qbo_invoice_id = $2, qbo_doc_number = $3, updated_at = now()
     WHERE id = $1`,
    [jobId, inv.id, inv.docNumber ?? null]
  );

  // 5) Send invoice email from QuickBooks
  await qboSendInvoice(undefined, inv.id, learnerEmail);

  // 6) Download PDF
  const pdf = await qboFetchInvoicePdf(undefined, inv.id);

  // 7) Upload to Drive
  const fileName = `QBO_Invoice_${safeText(inv.docNumber || inv.id)}_${safeText(enrolmentId)}.pdf`;
  const drive = await uploadInvoicePdfToDrive({ pdf, fileName });

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

