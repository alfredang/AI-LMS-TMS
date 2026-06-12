import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

type Verdict = 'verified' | 'mismatch';

/**
 * POST /api/admin/ca-verify-and-send
 *
 * Body: { companyApplicationId: uuid, verdict: 'verified' | 'mismatch', verifiedBy?: string }
 *
 * Marks the supporting-doc verification verdict on the row. Pure verification —
 * never triggers the invoice email. Sending is now exclusively driven by the
 * "Send Invoice Email" button on View Company Application (which gates on
 * supporting_doc_verification_status = 'verified' + the master toggle).
 *
 * mismatch verdict: clears the Drive file reference so the admin is forced
 * to re-upload the correct document before re-attempting verification.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const companyApplicationId = String(req.body?.companyApplicationId || '').trim();
    const verdict = String(req.body?.verdict || '').trim().toLowerCase() as Verdict;
    const verifiedBy = String(req.body?.verifiedBy || '').trim() || null;

    if (!companyApplicationId) {
      return res.status(400).json({ success: false, error: 'companyApplicationId is required' });
    }
    if (verdict !== 'verified' && verdict !== 'mismatch') {
      return res.status(400).json({ success: false, error: 'verdict must be "verified" or "mismatch"' });
    }

    const rowRes = await pool.query(
      `SELECT id FROM public.company_application WHERE id = $1`,
      [companyApplicationId]
    );
    if (!rowRes.rows[0]) {
      return res.status(404).json({ success: false, error: 'Company application row not found' });
    }

    if (verdict === 'mismatch') {
      await pool.query(
        `UPDATE public.company_application
            SET supporting_doc_verification_status = 'mismatch',
                supporting_doc_verified_at         = now(),
                supporting_doc_verified_by         = $2,
                supporting_doc_drive_file_id       = NULL,
                supporting_doc_drive_web_view_link = NULL,
                updated_at                         = now()
          WHERE id = $1`,
        [companyApplicationId, verifiedBy]
      );
      return res.status(200).json({ success: true, status: 'mismatch' });
    }

    await pool.query(
      `UPDATE public.company_application
          SET supporting_doc_verification_status = 'verified',
              supporting_doc_verified_at         = now(),
              supporting_doc_verified_by         = $2,
              updated_at                         = now()
        WHERE id = $1`,
      [companyApplicationId, verifiedBy]
    );

    return res.status(200).json({ success: true, status: 'verified' });
  } catch (err: any) {
    console.error('ca-verify-and-send error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to verify and send',
    });
  }
}
