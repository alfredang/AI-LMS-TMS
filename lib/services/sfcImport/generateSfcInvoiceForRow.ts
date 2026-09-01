import pool from '@/lib/db';
import { createDirectApplicationSfcInvoice } from '@/lib/quickbooks/createDirectApplicationSfcInvoice';

/**
 * Shared by the single-row and bulk "Generate SFC Invoice" routes — creates the DA claim's
 * supplemental SFC-CA invoice (never the main Customer/TC invoice) and links it into both
 * da_application and this batch's row.
 */
export async function generateSfcInvoiceForRow(input: {
  batchId: number;
  rowId: number;
  enrolmentId: string;
  claimId: string;
  applicationId: string;
  mainInvoiceDocNumber: string | null;
  fallbackAmount: number;
}): Promise<{ qboInvoiceId: string; qboDocNumber: string | null }> {
  const trimmedEnrolmentId = String(input.enrolmentId || '').trim();
  const trimmedClaimId = String(input.claimId || '').trim();
  const trimmedApplicationId = String(input.applicationId || '').trim();
  if (!trimmedEnrolmentId || !trimmedClaimId || !trimmedApplicationId) {
    throw new Error('enrolmentId, claimId and applicationId are required');
  }

  const created = await createDirectApplicationSfcInvoice({
    enrolmentId: trimmedEnrolmentId,
    mainInvoiceDocNumber: input.mainInvoiceDocNumber ? String(input.mainInvoiceDocNumber).trim() : null,
    sfcClaimId: trimmedClaimId,
    applicationId: trimmedApplicationId,
    fallbackAmount: Number(input.fallbackAmount) || 0,
  });
  if (!created?.invoiceId) {
    throw new Error('Failed to create the SFC-CA invoice in QuickBooks');
  }

  await pool.query(
    `UPDATE public.da_application SET sfc_invoice_id = $2::varchar
     WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))`,
    [trimmedEnrolmentId, created.invoiceId]
  );
  await pool.query(
    `UPDATE public.sfc_import_rows SET
       da_sfc_invoice_id = $2::varchar,
       matched_qbo_invoice_id = $2::varchar,
       matched_qbo_doc_number = $3::varchar,
       match_status = 'ready',
       apply_status = NULL,
       apply_error = NULL
     WHERE id = $1::int AND batch_id = $4::int`,
    [input.rowId, created.invoiceId, created.docNumber ?? null, input.batchId]
  );

  return { qboInvoiceId: created.invoiceId, qboDocNumber: created.docNumber ?? null };
}
