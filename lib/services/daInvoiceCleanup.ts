import pool from '../db';
import { safeDeleteInvoiceById, type InvoiceExpectation } from './cancelInvoiceSafety';

interface DaInvoiceRow {
  application_id: string;
  invoice_id: string | null;
  invoice_doc_number: string | null;
  grant_invoice_id: string | null;
  sfc_invoice_id: string | null;
  course_run_id: string | null;
}

const DA_COLUMNS = `application_id, invoice_id, invoice_doc_number, grant_invoice_id, sfc_invoice_id, course_run_id::text AS course_run_id`;
const isPlaceholderInvoiceId = (id: string | null | undefined) => /^(manual|n\/a|-)$/i.test((id || '').trim());

/**
 * Best-effort delete of a QBO invoice. Returns a warning string when the
 * invoice was not deleted (QB error, or refused by a safety check: payment applied,
 * not the expected invoice, group invoice), or `null` when the invoice was deleted
 * (or was already gone — QBO error 610 = Object Not Found).
 */
export async function deleteQboInvoiceIfPresent(
  invoiceId: string | null | undefined,
  label: string,
  expect: InvoiceExpectation = {},
): Promise<string | null> {
  const id = (invoiceId || '').trim();
  if (!id || isPlaceholderInvoiceId(id)) return null;
  const r = await safeDeleteInvoiceById(id, label, expect);
  return r.status === 'deleted' || r.status === 'gone' ? null : (r.message || `${label}: not deleted`);
}

/**
 * Delete the three QBO invoices (main / grant / SFC) attached to a DA row
 * and null out only successfully deleted invoice columns. QBO failures are returned
 * as warnings. Database write failures throw so retries retain their references.
 */
async function deleteDaInvoices(da: DaInvoiceRow, removeInvoice = deleteQboInvoiceIfPresent): Promise<string[]> {
  const [mainW, grantW, sfcW] = await Promise.all([
    removeInvoice(da.invoice_id, 'main', {
      docNumber: isPlaceholderInvoiceId(da.invoice_doc_number) ? null : da.invoice_doc_number,
      courseRunId: da.course_run_id,
    }),
    removeInvoice(da.grant_invoice_id, 'grant', { wsgCustomer: true }),
    removeInvoice(da.sfc_invoice_id, 'sfc', { docNumber: `SFC-${da.application_id}`, wsgCustomer: true }),
  ]);
  const warnings = [mainW, grantW, sfcW].filter((w): w is string => !!w);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE da_application
     SET application_status = 'Cancelled',
         enrolment_status = 'Cancelled',
         invoice_id = CASE WHEN $2 THEN NULL ELSE invoice_id END,
         invoice_doc_number = CASE WHEN $2 THEN NULL ELSE invoice_doc_number END,
         invoice_no = CASE WHEN $2 THEN NULL ELSE invoice_no END,
         invoice_drive_file_id = CASE WHEN $2 THEN NULL ELSE invoice_drive_file_id END,
         invoice_drive_web_view_link = CASE WHEN $2 THEN NULL ELSE invoice_drive_web_view_link END,
         grant_invoice_id = CASE WHEN $3 THEN NULL ELSE grant_invoice_id END,
         grant_invoice_drive_file_id = CASE WHEN $3 THEN NULL ELSE grant_invoice_drive_file_id END,
         grant_invoice_drive_web_view_link = CASE WHEN $3 THEN NULL ELSE grant_invoice_drive_web_view_link END,
         sfc_invoice_id = CASE WHEN $4 THEN NULL ELSE sfc_invoice_id END,
         sfc_invoice_drive_file_id = CASE WHEN $4 THEN NULL ELSE sfc_invoice_drive_file_id END,
         sfc_invoice_drive_web_view_link = CASE WHEN $4 THEN NULL ELSE sfc_invoice_drive_web_view_link END,
         updated_at = NOW()
     WHERE application_id = $1`,
      [da.application_id, !mainW, !grantW, !sfcW]
    );

    if (!mainW && da.invoice_id && !/^(manual|n\/a|-)$/i.test(da.invoice_id.trim())) {
      await client.query(`UPDATE invoice_jobs SET status = 'cancelled', qbo_invoice_id = NULL,
      qbo_doc_number = NULL, invoice_no = NULL, drive_file_id = NULL, drive_web_view_link = NULL,
      last_error = 'Direct Application cancelled; invoice removed', updated_at = NOW()
      WHERE qbo_invoice_id = $1`, [da.invoice_id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }

  return warnings;
}

/**
 * DA rows imported without a real enrolment id ('MANUAL' / blank) can't be found by enrolment_id.
 * Match them to the enrolment by course run + NRIC last 4 — only when exactly one row fits.
 */
async function findManualDaRows(enrolmentId: string): Promise<{ rows: DaInvoiceRow[]; warning?: string }> {
  const en = (await pool.query(
    `SELECT NULLIF(TRIM(course_run_id::text), '') AS run, UPPER(RIGHT(TRIM(COALESCE(trainee_nric, '')), 4)) AS nric4
     FROM ssg_enrolments WHERE enrolment_id = $1 ORDER BY imported_at DESC LIMIT 1`,
    [enrolmentId]
  )).rows[0];
  if (!en?.run || !en?.nric4 || en.nric4.length < 4) return { rows: [] };
  const r = await pool.query(
    `SELECT ${DA_COLUMNS} FROM da_application
     WHERE (enrolment_id IS NULL OR TRIM(enrolment_id) = '' OR enrolment_id ~* 'manual')
       AND TRIM(course_run_id::text) = $1
       AND UPPER(RIGHT(TRIM(COALESCE(trainee_id, '')), 4)) = $2`,
    [en.run, en.nric4]
  );
  if (r.rows.length > 1) {
    return { rows: [], warning: `${r.rows.length} MANUAL Direct Applications match run ${en.run} / NRIC …${en.nric4} (${r.rows.map((x) => x.application_id).join(', ')}) — none cleaned; needs review` };
  }
  return { rows: r.rows as DaInvoiceRow[] };
}

/**
 * If this enrolment belongs to Direct Application(s), delete the three QBO
 * invoices (main / grant / SFC) attached to each DA row. Best-effort —
 * failures are returned as warnings and never block the caller.
 */
export async function cleanupDaInvoicesForEnrolment(
  enrolmentId: string
): Promise<{ found: boolean; warnings: string[] }> {
  const r = await pool.query(
    `SELECT ${DA_COLUMNS} FROM da_application WHERE enrolment_id = $1 ORDER BY application_id`,
    [enrolmentId]
  );
  let rows = r.rows as DaInvoiceRow[];
  const warnings: string[] = [];
  if (!rows.length) {
    const manual = await findManualDaRows(enrolmentId);
    rows = manual.rows;
    if (manual.warning) warnings.push(manual.warning);
  }
  for (const da of rows) {
    const w = await deleteDaInvoices(da);
    warnings.push(...w.map((x) => (rows.length > 1 ? `${da.application_id} ${x}` : x)));
  }
  return { found: rows.length > 0 || warnings.length > 0, warnings };
}

/**
 * Same as {@link cleanupDaInvoicesForEnrolment}, but looked up by
 * `da_application.application_id` — use this when the caller already has
 * the DA row loaded and doesn't want to rely on `enrolment_id` matching.
 */
export async function cleanupDaInvoicesForApplicationId(
  applicationId: string,
  removeInvoice = deleteQboInvoiceIfPresent,
): Promise<{ found: boolean; warnings: string[] }> {
  const r = await pool.query(
    `SELECT ${DA_COLUMNS} FROM da_application WHERE application_id = $1 LIMIT 1`,
    [applicationId]
  );
  const da = r.rows[0] as DaInvoiceRow | undefined;
  if (!da) return { found: false, warnings: [] };
  const warnings = await deleteDaInvoices(da, removeInvoice);
  return { found: true, warnings };
}
