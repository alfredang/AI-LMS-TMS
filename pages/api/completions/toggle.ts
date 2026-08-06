import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { userId, subtopicId, courseRunId, isCompleted } = req.body;

    if (!userId || !subtopicId || !courseRunId || typeof isCompleted !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, subtopicId, courseRunId, isCompleted'
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(courseRunId as string)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid courseRunId format - must be UUID'
      });
    }

    if (isCompleted) {
      await pool.query(
        `INSERT INTO public.subtopic_completion (user_id, course_run_id, subtopic_id, completed_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, course_run_id, subtopic_id) DO NOTHING`,
        [userId, courseRunId, subtopicId]
      );
    } else {
      await pool.query(
        `DELETE FROM public.subtopic_completion
         WHERE user_id = $1 AND course_run_id = $2 AND subtopic_id = $3`,
        [userId, courseRunId, subtopicId]
      );
    }

    // Update progress percentage in enrollment table
    await pool.query(
      `UPDATE enrollment
       SET progress_percent = (
         SELECT
           CASE
             WHEN total_subtopics > 0
             THEN ROUND((completed_subtopics::DECIMAL / total_subtopics) * 100, 1)
             ELSE 0
           END
         FROM (
           SELECT
             COUNT(DISTINCT st.id) AS total_subtopics,
             COUNT(DISTINCT sc.subtopic_id) AS completed_subtopics
           FROM course c
           JOIN course_run cr ON c.id = cr.course_id
           JOIN learning_unit lu ON c.id = lu.course_id
           JOIN subtopic st ON lu.id = st.learning_unit_id
           LEFT JOIN subtopic_completion sc
             ON st.id = sc.subtopic_id
             AND sc.user_id = $1
             AND sc.course_run_id = $2
           WHERE cr.id = $2
         ) progress_stats
       )
       WHERE user_id = $1 AND course_run_id = $2`,
      [userId, courseRunId]
    );

    return res.status(200).json({
      success: true,
      message: isCompleted ? 'Completion added' : 'Completion removed'
    });

  } catch (error: any) {
    console.error('💥 Error toggling completion:', error?.message);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    });
  }
}

export default withAuth(handler);
