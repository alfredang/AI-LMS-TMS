import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { userId, topicId, courseRunId, isCompleted } = req.body;
  if (!userId || !topicId || !courseRunId) {
    return res.status(400).json({ success: false, error: 'userId, topicId, and courseRunId are required' });
  }

  try {
    if (isCompleted) {
      await pool.query(
        `INSERT INTO public.topic_completion (user_id, course_run_id, topic_id, completed_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, course_run_id, topic_id) DO NOTHING`,
        [userId, courseRunId, topicId]
      );
    } else {
      await pool.query(
        `DELETE FROM public.topic_completion
         WHERE user_id = $1 AND course_run_id = $2 AND topic_id = $3`,
        [userId, courseRunId, topicId]
      );
    }

    // Update enrollment.progress_percent combining subtopic + topic completions
    await pool.query(
      `UPDATE public.enrollment
       SET progress_percent = (
         SELECT CASE WHEN total_items > 0
           THEN ROUND((completed_items::DECIMAL / total_items) * 100, 1)
           ELSE 0 END
         FROM (
           SELECT
             (
               SELECT COUNT(*) FROM (
                 SELECT lu.id FROM public.learning_unit lu
                 JOIN public.course_run cr ON cr.course_id = lu.course_id
                 LEFT JOIN public.subtopic st ON st.learning_unit_id = lu.id
                 WHERE cr.id = $2
                 GROUP BY lu.id
                 HAVING COUNT(st.id) = 0
               ) topics_without_subtopics
             ) +
             (
               SELECT COUNT(*) FROM public.subtopic st
               JOIN public.learning_unit lu ON lu.id = st.learning_unit_id
               JOIN public.course_run cr ON cr.course_id = lu.course_id
               WHERE cr.id = $2
             ) AS total_items,
             (
               SELECT COUNT(*) FROM public.topic_completion tc
               WHERE tc.user_id = $1 AND tc.course_run_id = $2
             ) +
             (
               SELECT COUNT(*) FROM public.subtopic_completion sc
               WHERE sc.user_id = $1 AND sc.course_run_id = $2
             ) AS completed_items
         ) stats
       )
       WHERE user_id = $1 AND course_run_id = $2`,
      [userId, courseRunId]
    );

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('❌ Error toggling topic completion:', error?.message);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}
