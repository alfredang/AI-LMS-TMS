import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

/**
 * POST /api/admin/ca-toggle-grant-eligibility
 *
 * Body: { applicationId: string, ineligible: boolean }
 *
 * Marks a single company_application row as permanently grant-ineligible
 * (or unmarks it). Used when a learner can't qualify for any SSG funding
 * (e.g. non-citizen/PR, age out of band) — the invoice guard treats these
 * rows as if they had a grant, so the group can be billed at full fee for
 * the ineligible learner without the whole group being blocked.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationId, ineligible } = req.body || {};
  const id = String(applicationId || '').trim();
  if (!id) {
    return res.status(400).json({ success: false, error: 'applicationId is required' });
  }
  if (typeof ineligible !== 'boolean') {
    return res.status(400).json({ success: false, error: 'ineligible must be a boolean' });
  }

  try {
    await ensureCompanyApplicationsTable();
    const result = await pool.query(
      `UPDATE public.company_application
          SET grant_ineligible = $1,
              updated_at       = now()
        WHERE id = $2
        RETURNING id, grant_ineligible`,
      [ineligible, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Row not found' });
    }

    return res.status(200).json({
      success: true,
      applicationId: result.rows[0].id,
      grantIneligible: !!result.rows[0].grant_ineligible,
    });
  } catch (err) {
    console.error('[ca-toggle-grant-eligibility] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
