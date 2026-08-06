import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// GET ?courseRunId=xxx
// Returns:
//   totalSessions      — total session count for the run
//   sessions           — list of sessions in display order (id, number, title, dates)
//   data               — per-learner attendance: attendedCount + per-session presence map
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  const client = await pool.connect();
  try {
    const [sessionsResult, attendanceResult] = await Promise.all([
      client.query(
        `SELECT id, session_number, title, start_date, end_date, ssg_session_id
         FROM course_session
         WHERE course_run_id = $1
         ORDER BY CAST(NULLIF(regexp_replace(COALESCE(session_number, ''), '[^0-9]', '', 'g'), '') AS integer) ASC NULLS LAST,
                  start_date ASC NULLS LAST`,
        [courseRunId]
      ),
      client.query(
        `SELECT ca.session_id, ca.nric, ca.user_id, ca.is_present
         FROM course_attendance ca
         WHERE ca.session_id IN (
           SELECT id FROM course_session WHERE course_run_id = $1
         )`,
        [courseRunId]
      ),
    ]);

    const sessions = sessionsResult.rows.map(r => ({
      id: r.id,
      sessionNumber: r.session_number || null,
      title: r.title || null,
      startDate: r.start_date || null,
      endDate: r.end_date || null,
      ssgSessionId: r.ssg_session_id || null,
    }));
    const totalSessions = sessions.length;

    const byLearner = new Map<string, { nric: string; userId: string; attendedCount: number; sessions: Record<string, boolean> }>();
    for (const row of attendanceResult.rows) {
      const key = `${row.nric || ''}|${row.user_id || ''}`;
      let learner = byLearner.get(key);
      if (!learner) {
        learner = { nric: row.nric || '', userId: row.user_id || '', attendedCount: 0, sessions: {} };
        byLearner.set(key, learner);
      }
      learner.sessions[row.session_id] = !!row.is_present;
      if (row.is_present) learner.attendedCount++;
    }

    return res.status(200).json({
      success: true,
      totalSessions,
      sessions,
      data: Array.from(byLearner.values()),
    });
  } catch (err) {
    console.error('Error fetching attendance summary:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
