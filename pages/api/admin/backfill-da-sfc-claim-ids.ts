/**
 * POST /api/admin/backfill-da-sfc-claim-ids
 *
 * Sweeps every Direct Application whose SkillsFuture Credit claim id is blank
 * and fills it from `ssg_claims`, matched on enrolment id. Use once to catch up
 * existing rows — from then on the SFC payout import keeps them current
 * (lib/services/sfcImport/sfcImportApply.ts).
 *
 * Body: { dryRun?: boolean, enrolmentId?: string }
 *   dryRun (DEFAULT TRUE) — report what would change, write nothing.
 *   enrolmentId — restrict to a single enrolment.
 *
 * Only ever fills a blank; it cannot overwrite or clear an existing claim id.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { backfillDaSfcClaimIds } from '@lib/daSfcClaimBackfill';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'finance']);
  if (!user) return; // requireRole already sent 401/403

  try {
    const dryRun = req.body?.dryRun !== false; // default TRUE (safe)
    const enrolmentId =
      typeof req.body?.enrolmentId === 'string' && req.body.enrolmentId.trim()
        ? req.body.enrolmentId.trim()
        : null;

    const result = await backfillDaSfcClaimIds({ dryRun, enrolmentId });

    return res.status(200).json({
      success: true,
      dryRun: result.dryRun,
      matched: result.matched.length,
      updated: result.updated,
      message: result.dryRun
        ? `${result.matched.length} Direct Application(s) would get a claim id. Nothing was changed.`
        : `Filled ${result.updated} claim id(s).`,
      // Capped so a large sweep can't return an unwieldy payload.
      rows: result.matched.slice(0, 200),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Backfill failed';
    console.error('❌ backfill-da-sfc-claim-ids:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
}
