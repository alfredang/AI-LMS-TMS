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
 * Current use (2026-07-30): creates ONE test enrollment row (course_run 1169306, real
 * course, fake learner) for tertiarytesting@gmail.com, to verify the
 * auto-send-course-confirmation window/dedupe fix end-to-end without touching a real
 * trainee. Idempotent — checks for an existing test row first via enrolment_id prefix
 * 'TEST-CONFIRM-EMAIL-', so re-running this doesn't create duplicates.
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
    console.log('🔄 Running migration: create test enrollment for confirmation-email verification...');

    const existing = await pool.query(
      `SELECT id, enrolment_id FROM enrollment WHERE enrolment_id LIKE 'TEST-CONFIRM-EMAIL-%' LIMIT 1`
    );
    if (existing.rows.length > 0) {
      console.log(`ℹ️ Test enrollment already exists: ${existing.rows[0].enrolment_id}`);
      return res.status(200).json({
        success: true,
        message: 'Test enrollment already exists (idempotent no-op)',
        enrollment: existing.rows[0],
      });
    }

    const enrolmentId = `TEST-CONFIRM-EMAIL-${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO enrollment (
         id, user_id, course_id, course_run_id,
         progress_percent, payment_status, assessment_status,
         enrolment_date, enrolment_id, enrolment_status,
         nric, email, calendar_added, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), NULL, '3ac6b597-55df-4df1-ad20-d009976416c2', '002371ff-0386-45fc-9381-2d8b81047e01',
         0, 'Unpaid', 'Pending',
         CURRENT_DATE, $1, 'Confirmed',
         'TESTNRIC01', 'tertiarytesting@gmail.com', false, NOW(), NOW()
       ) RETURNING id, enrolment_id, enrolment_status, course_run_id, email`,
      [enrolmentId]
    );
    console.log(`✅ Created test enrollment ${enrolmentId}`);

    return res.status(200).json({
      success: true,
      message: 'Migration completed successfully',
      enrollment: result.rows[0],
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
