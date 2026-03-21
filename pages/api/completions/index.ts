import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface CompletedSubtopic {
  learning_unit_id: string;
  learning_unit_title: string;
  learning_unit_position: number;
  subtopic_id: string;
  subtopic_title: string;
  subtopic_position: number;
  completed_at: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { userId, courseRunId } = req.query;

    if (!userId || !courseRunId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: userId, courseRunId' 
      });
    }

    console.log(`🔍 Fetching completions for userId: ${userId}, courseRunId: ${courseRunId}`);

    // Validate courseRunId format (should be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(courseRunId as string)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid courseRunId format - must be UUID' 
      });
    }

    const result = await pool.query(
      `SELECT
         lu.id         AS learning_unit_id,
         lu.title      AS learning_unit_title,
         lu."position" AS learning_unit_position,
         st.id         AS subtopic_id,
         st.title      AS subtopic_title,
         st."position" AS subtopic_position,
         sc.completed_at
       FROM public.subtopic_completion sc
       JOIN public.subtopic st        ON st.id = sc.subtopic_id
       JOIN public.learning_unit lu   ON lu.id = st.learning_unit_id
       WHERE sc.user_id       = $1
         AND sc.course_run_id = $2
       ORDER BY lu."position", st."position"`,
      [userId, courseRunId]
    );

    return res.status(200).json({ 
      success: true, 
      data: result.rows as CompletedSubtopic[]
    });

  } catch (error) {
    console.error('💥 Error fetching completions:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
