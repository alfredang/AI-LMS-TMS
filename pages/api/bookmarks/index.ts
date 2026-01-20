import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface BookmarkedSubtopic {
  learning_unit_id: string;
  learning_unit_title: string;
  learning_unit_position: number;
  subtopic_id: string;
  subtopic_title: string;
  subtopic_position: number;
  bookmarked_at: string;
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

    // Both learner and trainer roles now provide courseRunId as UUID
    const courseRunUuid = Array.isArray(courseRunId) ? courseRunId[0] : courseRunId;
    
    // Validate that courseRunId is in UUID format
    if (!courseRunUuid || (!courseRunUuid.includes('-') || courseRunUuid.includes('_'))) {
      console.error('❌ Bookmark retrieval received invalid courseRunId format:', courseRunUuid);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid courseRunId format. Expected UUID, received: ' + courseRunUuid 
      });
    }

    console.log(`🔍 Loading bookmarks: userId=${userId}, courseRunId=${courseRunId} (${courseRunUuid})`);

    const result = await pool.query(
      `SELECT
         lu.id           AS learning_unit_id,
         lu.title        AS learning_unit_title,
         lu."position"   AS learning_unit_position,
         st.id           AS subtopic_id,
         st.title        AS subtopic_title,
         st."position"   AS subtopic_position,
         b.created_at    AS bookmarked_at
       FROM public.user_subtopic_bookmark AS b
       JOIN public.subtopic        AS st ON st.id = b.subtopic_id
       JOIN public.learning_unit   AS lu ON lu.id = st.learning_unit_id
       WHERE b.user_id = $1
         AND b.course_run_id = $2
       ORDER BY lu."position", st."position"`,
      [userId, courseRunUuid]
    );

    console.log(`✅ Found ${result.rows.length} bookmarks for course run ${courseRunUuid}`);
    if (result.rows.length > 0) {
      console.log(`🔖 Bookmarked subtopics:`, result.rows.map(row => `${row.subtopic_title} (${row.subtopic_id})`));
    }

    return res.status(200).json({ 
      success: true, 
      data: result.rows as BookmarkedSubtopic[]
    });

  } catch (error) {
    console.error('💥 Error fetching bookmarks:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
