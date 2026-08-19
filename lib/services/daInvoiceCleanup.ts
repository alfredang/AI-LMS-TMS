import pool from '../db';
import { qboReadInvoice, qboDeleteInvoice } from './qboInvoiceService';

interface DaInvoiceRow {
  application_id: string;
  invoice_id: string | null;
  grant_invoice_id: string | null;
  sfc_invoice_id: string | null;
}

/**
 * Best-effort delete of a QBO invoice. Returns a warning string when the
 * deletion failed for a real reason, or `null` when the invoice was deleted
 * (or was already gone — QBO error 610 = Object Not Found).
 */
export async function deleteQboInvoiceIfPresent(
  invoiceId: string | null | undefined,
  label: string,
): Promise<string | null> {
  const id = (invoiceId || '').trim();
  if (!id) return null;
  try {
    const inv = await qboReadInvoice(undefined, id);
    if (inv?.syncToken) {
      await qboDeleteInvoice(undefined, id, inv.syncToken);
    }
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (msg.includes('610') || lower.includes('not found') || lower.includes('object not found')) {
      return null;
    }
    return `${label}: ${msg}`;
  }
}

/**
 * Delete the three QBO invoices (main / grant / SFC) attached to a DA row
 * and null out the invoice columns. Best-effort — QBO failures are returned
 * as warnings, never thrown.
 */
async function deleteDaInvoices(da: DaInvoiceRow): Promise<string[]> {
  const [mainW, grantW, sfcW] = await Promise.all([
    deleteQboInvoiceIfPresent(da.invoice_id, 'main'),
    deleteQboInvoiceIfPresent(da.grant_invoice_id, 'grant'),
    deleteQboInvoiceIfPresent(da.sfc_invoice_id, 'sfc'),
  ]);
  const warnings = [mainW, grantW, sfcW].filter((w): w is string => !!w);

  await pool.query(
    `UPDATE da_application
     SET application_status = 'Cancelled',
         enrolment_status = 'Cancelled',
         invoice_id = NULL,
         invoice_doc_number = NULL,
         invoice_no = NULL,
         invoice_drive_file_id = NULL,
         invoice_drive_web_view_link = NULL,
         grant_invoice_id = NULL,
         grant_invoice_drive_file_id = NULL,
         grant_invoice_drive_web_view_link = NULL,
         sfc_invoice_id = NULL,
         sfc_invoice_drive_file_id = NULL,
         sfc_invoice_drive_web_view_link = NULL,
         updated_at = NOW()
     WHERE application_id = $1`,
    [da.application_id]
  );

  return warnings;
}

/**
 * If this enrolment belongs to a Direct Application, delete the three QBO
 * invoices (main / grant / SFC) attached to the DA row. Best-effort —
 * failures are returned as warnings and never block the caller.
 */
export async function cleanupDaInvoicesForEnrolment(
  enrolmentId: string
): Promise<{ found: boolean; warnings: string[] }> {
  const r = await pool.query(
    `SELECT application_id, invoice_id, grant_invoice_id, sfc_invoice_id
     FROM da_application
     WHERE enrolment_id = $1
     LIMIT 1`,
    [enrolmentId]
  );
  const da = r.rows[0] as DaInvoiceRow | undefined;
  if (!da) return { found: false, warnings: [] };
  const warnings = await deleteDaInvoices(da);
  return { found: true, warnings };
}

/**
 * Same as {@link cleanupDaInvoicesForEnrolment}, but looked up by
 * `da_application.application_id` — use this when the caller already has
 * the DA row loaded and doesn't want to rely on `enrolment_id` matching.
 */
export async function cleanupDaInvoicesForApplicationId(
  applicationId: string
): Promise<{ found: boolean; warnings: string[] }> {
  const r = await pool.query(
    `SELECT application_id, invoice_id, grant_invoice_id, sfc_invoice_id
     FROM da_application
     WHERE application_id = $1
     LIMIT 1`,
    [applicationId]
  );
  const da = r.rows[0] as DaInvoiceRow | undefined;
  if (!da) return { found: false, warnings: [] };
  const warnings = await deleteDaInvoices(da);
  return { found: true, warnings };
}
