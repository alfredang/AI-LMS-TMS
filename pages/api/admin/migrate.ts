import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { requireRole } from '@lib/auth/requireRole';

/**
 * POST /api/admin/migrate
 *
 * One-off, hand-editable data/schema fix runner — repurposed per use (see git history for
 * prior migrations run through this route). Previously had NO auth check despite running
 * arbitrary mutating SQL on every POST; fixed 2026-07-24 per CLAUDE.md's API security policy
 * (every data-mutating pages/api/** route must authenticate). Also switched off a stray
 * DB_USER/DB_HOST/... Pool (inconsistent with the rest of the app) onto the standard
 * lib/db.ts pool (DATABASE_URL), which every other route already relies on.
 *
 * Current migration: see database/migrations/fix_cross_contaminated_calendar_event_mapping.sql
 * — removes 2 bad course_run_calendar_event rows created by a fuzzy-title-match bug.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['admin', 'developer']);
  if (!authed) return;

  try {
    console.log('🔄 Running migration: remove cross-contaminated course_run_calendar_event rows...');

    const result = await pool.query(
      `DELETE FROM course_run_calendar_event
       WHERE course_run_id = 'd1f4171e-5a3d-42fa-b598-56bd95318e89'
         AND google_event_id IN (
           'p2m6ec0kqethhi35tlaeggr66g_20260727T013000Z',
           'p2m6ec0kqethhi35tlaeggr66g_20260728T013000Z'
         )`
    );
    console.log(`✅ Deleted ${result.rowCount} bad course_run_calendar_event row(s)`);

    return res.status(200).json({
      success: true,
      message: 'Migration completed successfully',
      deleted_rows: result.rowCount,
    });
  } catch (error) {
    console.error('❌ Migration failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

export default handler;
