/**
 * POST /api/admin/da-enrol-status
 *
 * Returns just the auto-enrolment progress fields for the given application ids.
 *
 * The upload screen used to poll /api/admin/fetch-all-da-applications every 5
 * seconds to watch a handful of rows — a 1-2.5s query returning every DA row in
 * the system (200+), repeated for the whole enrolment. This returns only the
 * requested rows and only the columns the progress display reads.
 *
 * Body: { applicationIds: string[] }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';

/** Guard against an unbounded IN list from a runaway caller. */
const MAX_IDS = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider', 'finance']);
  if (!user) return; // requireRole already sent 401/403

  const raw = req.body?.applicationIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds must be a non-empty array' });
  }

  const applicationIds = raw
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v: string) => v.trim())
    .slice(0, MAX_IDS);

  if (applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'no valid application ids supplied' });
  }

  try {
    const result = await pool.query(
      `SELECT application_id,
              auto_enrol_status,
              auto_enrol_error,
              enrolment_id,
              grant_id,
              invoice_id,
              calendar_added
         FROM da_application
        WHERE application_id = ANY($1::text[])`,
      [applicationIds]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read enrolment status';
    console.error('❌ da-enrol-status:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
}
