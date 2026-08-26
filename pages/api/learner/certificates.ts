import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required parameter: userId' });
  }

  try {
    const result = await pool.query(
      `SELECT
         e.id AS enrollment_id,
         c.title AS course_title,
         c.course_code,
         cr.course_run_id,
         cr.start_date,
         cr.end_date,
         e.assessment_status,
         -- '__generating__' is the in-flight claim marker the auto-create cron
         -- writes before the real Drive URL lands; it is not a downloadable URL.
         NULLIF(e.certificate, '__generating__') AS certificate_url
       FROM enrollment e
       JOIN course c ON c.id = e.course_id
       JOIN course_run cr ON cr.id = e.course_run_id
       WHERE e.user_id = $1
       ORDER BY cr.start_date DESC NULLS LAST`,
      [userId]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('[learner/certificates] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler);
