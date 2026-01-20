import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    console.log(`🔍 Toggling completion for userId: ${userId}, subtopicId: ${subtopicId}, courseRunId: ${courseRunId}, isCompleted: ${isCompleted}`);

    // Validate courseRunId format (should be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(courseRunId as string)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid courseRunId format - must be UUID' 
      });
    }

    if (isCompleted) {
      // Add completion
      await pool.query(
        `INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at)
         SELECT
           e.id         AS enrollment_id,
           st.id        AS subtopic_id,
           NOW()        AS completed_at
         FROM public.enrollment      e
         JOIN public.subtopic        st  ON st.id = $2
         JOIN public.learning_unit   lu  ON lu.id = st.learning_unit_id
         WHERE e.user_id         = $1
           AND e.course_run_id   = $3
         ON CONFLICT (enrollment_id, subtopic_id) DO NOTHING`,
        [userId, subtopicId, courseRunId]
      );
    } else {
      // Remove completion
      await pool.query(
        `DELETE FROM public.subtopic_completion sc
         USING public.enrollment      e,
               public.subtopic        st,
               public.learning_unit   lu
         WHERE sc.enrollment_id = e.id
           AND sc.subtopic_id   = st.id
           AND st.id            = $2
           AND lu.id            = st.learning_unit_id
           AND e.user_id        = $1
           AND e.course_run_id  = $3`,
        [userId, subtopicId, courseRunId]
      );
    }

    // Update progress percentage in enrollment table (for specific course run)
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
           LEFT JOIN subtopic_completion sc ON st.id = sc.subtopic_id
             AND sc.enrollment_id = enrollment.id
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

  } catch (error) {
    console.error('💥 Error toggling completion:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
