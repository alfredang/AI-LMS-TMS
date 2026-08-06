/**
 * POST /api/admin/repair-da-enrol-status
 *
 * Corrects Direct Applications marked 'failed' that hold a real SSG enrolment
 * reference — rows where the enrolment succeeded but a later step (invoice,
 * Drive, grant/SFC) failed and wrongly downgraded the whole row.
 *
 * Body: { dryRun?: boolean }   dryRun DEFAULTS TO TRUE.
 *
 * Only ever moves a row OFF 'failed', and only when the enrolment reference
 * proves it enrolled. auto_enrol_error is left intact so the underlying failure
 * stays visible.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { repairFalseEnrolFailures } from '@lib/daEnrolStatusRepair';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return; // requireRole already sent 401/403

  try {
    const dryRun = req.body?.dryRun !== false; // default TRUE (safe)
    const result = await repairFalseEnrolFailures({ dryRun });

    return res.status(200).json({
      success: true,
      dryRun: result.dryRun,
      matched: result.matched.length,
      updated: result.updated,
      message: result.dryRun
        ? `${result.matched.length} row(s) are marked failed but are actually enrolled. Nothing was changed.`
        : `Corrected ${result.updated} row(s).`,
      rows: result.matched.slice(0, 200),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Repair failed';
    console.error('❌ repair-da-enrol-status:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
}
