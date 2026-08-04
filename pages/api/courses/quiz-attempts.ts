import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/courses/quiz-attempts?userId=...&courseId=...
 *
 * Returns every quiz attempt the given learner has made on the given
 * course, most recent first. Used by the Course Detail view to render
 * "last score: 7/10" next to each Quiz resource.
 *
 * If multiple attempts exist for the same quiz, the client should use
 * the first row returned (highest created_at) as the "latest" score.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : '';

  if (!userId || !courseId) {
    return res.status(400).json({ success: false, error: 'userId and courseId are required' });
  }

  try {
    const r = await pool.query(
      `SELECT id, quiz_id, score, total, answers, completed_at
       FROM quiz_attempt
       WHERE user_id = $1 AND course_id = $2
       ORDER BY completed_at DESC`,
      [userId, courseId]
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err) {
    console.error('❌ quiz-attempts error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
