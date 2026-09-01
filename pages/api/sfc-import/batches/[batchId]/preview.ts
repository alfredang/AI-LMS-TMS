import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { getSfcImportBatch, getSfcImportRows } from '@/lib/services/sfcImport/sfcImportDb';
import pool from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const batch = await getSfcImportBatch(batchId);
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const rows = await getSfcImportRows(batchId);

    // Enrich rows with live FMS claim_payment_status
    const claimIds = Array.from(new Set(rows.map((r: any) => String(r.claim_id || '')).filter(Boolean)));
    let fmsStatusMap = new Map<string, string>();
    if (claimIds.length > 0) {
      const r = await pool.query(
        `SELECT claim_id::text AS claim_id, COALESCE(claim_payment_status, 'NOT_RECEIVED') AS claim_payment_status
         FROM public.ssg_claims WHERE claim_id = ANY($1::text[])`,
        [claimIds]
      );
      for (const row of r.rows) {
        fmsStatusMap.set(String(row.claim_id), String(row.claim_payment_status));
      }
    }

    // Enrich rows with DA flag (enrolment_id exists in da_application)
    const enrolmentIds = Array.from(new Set(rows.map((r: any) => String(r.matched_enrolment_id || '')).filter(Boolean)));
    const daEnrolmentSet = new Set<string>();
    if (enrolmentIds.length > 0) {
      const daRes = await pool.query(
        `SELECT DISTINCT enrolment_id::text AS enrolment_id
         FROM public.da_application
         WHERE enrolment_id = ANY($1::text[])`,
        [enrolmentIds]
      );
      for (const row of daRes.rows) daEnrolmentSet.add(String(row.enrolment_id));
    }

    const enrichedRows = rows.map((r: any) => {
      // "Paid"/"Applied" must only ever be shown when THIS row currently has a verified invoice
      // backing it up — i.e. match_status is 'ready' or 'already_applied'. ssg_claims.claim_
      // payment_status is a historical field that can still say PAID from an earlier run even
      // when this row can't currently resolve any invoice at all (unmatched/invalid/needs_review)
      // — a claim cannot be "paid in QuickBooks" if we have no current QuickBooks invoice to
      // point at, so showing Paid there would be exactly the "confident badge, no evidence behind
      // it" problem already fixed for needs_review, just via a different match_status.
      const hasCurrentInvoiceEvidence = ['ready', 'already_applied'].includes(String(r.match_status || ''));
      return {
        ...r,
        fms_updated: hasCurrentInvoiceEvidence && fmsStatusMap.get(String(r.claim_id || '')) === 'PAID',
        qb_updated:
          hasCurrentInvoiceEvidence &&
          (String(r.match_status || '') === 'already_applied' ||
            String(r.apply_status || '') === 'applied' ||
            !!r.matched_qb_payment_id ||
            (r.matched_qbo_invoice_balance != null && Number(r.matched_qbo_invoice_balance) === 0)),
        is_da: daEnrolmentSet.has(String(r.matched_enrolment_id || '')),
      };
    });

    return res.status(200).json({ success: true, data: { batch, rows: enrichedRows } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
