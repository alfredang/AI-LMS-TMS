import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/calendar/my-events?role=trainer|learner&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Session-day events for the AUTHENTICATED user's own classes (My Calendar).
 * One event per (course run, day with >=1 session), like the admin calendar,
 * but scoped to the caller:
 *   - trainer: runs assigned via course_run_trainer, the legacy scalars, or a
 *     per-session trainer override
 *   - learner: runs the user is enrolled in (cancelled enrolments excluded)
 */

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
// course_session.start_date is compact YYYYMMDD text
const isoToCompact = (iso: string): string => iso.replace(/-/g, '');
const compactToIso = (compact: string): string =>
  compact && compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : compact || '';

const TRAINER_SCOPE = `(
  cr.assigned_trainer_id::text = $3
  OR cr.tpg_assigned_trainer_id::text = $3
  OR EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id AND crt.trainer_id::text = $3)
  OR EXISTS (SELECT 1 FROM course_session css WHERE css.course_run_id = cr.id AND css.deleted = false AND css.trainer_id::text = $3)
)`;

const LEARNER_SCOPE = `EXISTS (
  SELECT 1 FROM enrollment e
  WHERE e.course_run_id = cr.id
    AND e.user_id::text = $3
    AND (e.enrolment_status IS NULL OR e.enrolment_status NOT ILIKE 'cancel%')
)`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { start, end, role } = req.query;
  if (typeof start !== 'string' || !isoDateRegex.test(start)) {
    return res.status(400).json({ success: false, error: 'start must be YYYY-MM-DD' });
  }
  if (typeof end !== 'string' || !isoDateRegex.test(end)) {
    return res.status(400).json({ success: false, error: 'end must be YYYY-MM-DD' });
  }
  if (role !== 'trainer' && role !== 'learner') {
    return res.status(400).json({ success: false, error: "role must be 'trainer' or 'learner'" });
  }

  const authUser = (req as AuthedApiRequest).authUser;
  // Service callers (x-api-key) must say whose calendar they want; users get their own.
  const userId = authUser?.isService ? String(req.query.userId || '') : String(authUser?.id || '');
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required for service callers' });
  }

  try {
    const result = await pool.query(
      `
      WITH my_runs AS (
        SELECT cr.id, cr.course_run_id, cr.class_status, c.title AS course_title, c.course_code
        FROM course_run cr
        JOIN course c ON c.id = cr.course_id
        WHERE ${role === 'trainer' ? TRAINER_SCOPE : LEARNER_SCOPE}
      ),
      day_agg AS (
        SELECT
          cs.course_run_id,
          cs.start_date AS session_date,
          MIN(cs.start_time) AS earliest_start,
          MAX(cs.end_time)   AS latest_end,
          COUNT(*)           AS session_count
        FROM course_session cs
        JOIN my_runs mr ON mr.id = cs.course_run_id
        WHERE cs.deleted = false
          AND cs.start_date IS NOT NULL
          AND cs.start_date <> ''
        GROUP BY cs.course_run_id, cs.start_date
      ),
      ranked AS (
        SELECT
          da.*,
          DENSE_RANK() OVER (PARTITION BY da.course_run_id ORDER BY da.session_date) AS day_number,
          COUNT(*)     OVER (PARTITION BY da.course_run_id)                          AS total_days
        FROM day_agg da
      )
      SELECT
        mr.id AS course_run_uuid,
        mr.course_run_id,
        mr.course_title,
        mr.course_code,
        mr.class_status,
        r.session_date,
        r.earliest_start AS start_time,
        r.latest_end AS end_time,
        r.day_number,
        r.total_days,
        r.session_count
      FROM ranked r
      JOIN my_runs mr ON mr.id = r.course_run_id
      WHERE r.session_date >= $1 AND r.session_date <= $2
      ORDER BY r.session_date ASC, r.earliest_start ASC, mr.course_run_id ASC
      `,
      [isoToCompact(start), isoToCompact(end), userId]
    );

    const events = result.rows.map((row: any) => ({
      courseRunUuid: row.course_run_uuid,
      courseRunId: row.course_run_id,
      courseCode: row.course_code,
      courseTitle: row.course_title,
      classStatus: row.class_status,
      date: compactToIso(row.session_date),
      startTime: row.start_time || '',
      endTime: row.end_time || '',
      dayNumber: Number(row.day_number),
      totalDays: Number(row.total_days),
      sessionCount: Number(row.session_count),
    }));

    return res.status(200).json({ success: true, data: { events } });
  } catch (error) {
    console.error('[my-events] Database error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch calendar events' });
  }
}

export default withAuth(handler);
