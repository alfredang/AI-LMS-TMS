import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { generateSfcInvoiceForRow } from '@/lib/services/sfcImport/generateSfcInvoiceForRow';
import { realApplicationId } from '@/lib/daApplicationId';

/**
 * Bulk counterpart to generate-sfc-invoice.ts — runs it for every DA row in this batch that's
 * Ready but has no SFC-CA invoice yet, one at a time (sequential, not parallel: QuickBooks rate
 * limits, and createDirectApplicationSfcInvoice's own per-enrolment idempotency search is safest
 * run one call at a time rather than racing concurrent creates for different rows).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const r = await pool.query(
      `SELECT id, claim_id, matched_enrolment_id, da_application_id, main_qbo_doc_number,
              claim_amount::float AS claim_amount
       FROM public.sfc_import_rows
       WHERE batch_id = $1::int
         AND match_status = 'ready'
         AND da_application_id IS NOT NULL
         AND (matched_qbo_doc_number IS NULL OR matched_qbo_doc_number NOT ILIKE 'SFC-%')
       ORDER BY row_index ASC`,
      [batchId]
    );

    const eligible = (r.rows as Array<{
      id: number;
      claim_id: string | null;
      matched_enrolment_id: string | null;
      da_application_id: string | null;
      main_qbo_doc_number: string | null;
      claim_amount: number | null;
    }>).filter((row) => !!realApplicationId(row.da_application_id));

    const total = eligible.length;
    let generated = 0;
    let failed = 0;
    const errors: Array<{ rowId: number; claimId: string | null; error: string }> = [];

    for (const row of eligible) {
      try {
        await generateSfcInvoiceForRow({
          batchId,
          rowId: row.id,
          enrolmentId: row.matched_enrolment_id || '',
          claimId: row.claim_id || '',
          applicationId: row.da_application_id || '',
          mainInvoiceDocNumber: row.main_qbo_doc_number,
          fallbackAmount: row.claim_amount ?? 0,
        });
        generated++;
      } catch (e) {
        failed++;
        errors.push({ rowId: row.id, claimId: row.claim_id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return res.status(200).json({ success: true, data: { total, generated, failed, errors } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
