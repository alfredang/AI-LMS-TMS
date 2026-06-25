import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getLearnerAttendance } from '../../../lib/services/learnerAttendance';

/**
 * GET /api/admin/attendance-status?courseRunId=<ssgRunId>&traineeId=<nric>
 *
 * Read-only. Returns a learner's attendance for a course run — per-session present/absent detail +
 * overall % — vs the configured `certificate_attendance_threshold`. Source is the LOCAL
 * course_attendance (QR/TPG digital + manual marks), which is more complete than TPG alone. Used by
 * the Submit/Update Assessment views.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const courseRunId = String(req.query.courseRunId || '').trim();
  const traineeId = String(req.query.traineeId || '').trim();
  if (!courseRunId || !traineeId) {
    return res.status(400).json({ success: false, error: 'courseRunId and traineeId are required' });
  }

  try {
    const att = await getLearnerAttendance(courseRunId, traineeId);

    const thr = (await pool.query<{ t: string | null }>(
      `SELECT certificate_attendance_threshold AS t FROM training_provider LIMIT 1`
    )).rows[0]?.t;
    const threshold = parseFloat(String(thr ?? '').replace('%', '')) || 0;

    const met = att.available && att.percent >= threshold;

    return res.status(200).json({
      success: true,
      available: att.available,
      reason: att.reason,
      met,
      percent: att.percent,
      present: att.present,
      totalWithAttendance: att.totalWithAttendance,
      totalSessions: att.totalSessions,
      threshold,
      sessions: att.sessions,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}
