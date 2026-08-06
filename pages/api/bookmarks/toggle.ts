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
    const { userId, subtopicId, courseRunId, isBookmarked } = req.body;

    if (!userId || !subtopicId || !courseRunId || typeof isBookmarked !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: userId, subtopicId, courseRunId, isBookmarked' 
      });
    }

    // Both learner and trainer roles now provide courseRunId as UUID
    const courseRunUuid = Array.isArray(courseRunId) ? courseRunId[0] : courseRunId;
    
    // Validate that courseRunId is in UUID format
    if (!courseRunUuid || (!courseRunUuid.includes('-') || courseRunUuid.includes('_'))) {
      console.error('❌ Bookmark toggle received invalid courseRunId format:', courseRunUuid);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid courseRunId format. Expected UUID, received: ' + courseRunUuid 
      });
    }

    console.log(`🔖 Bookmark toggle: userId=${userId}, subtopicId=${subtopicId}, courseRunId=${courseRunId} (${courseRunUuid}), isBookmarked=${isBookmarked}`);

    if (isBookmarked) {
      // Add bookmark - use ON CONFLICT to handle case where bookmark already exists
      await pool.query(
        `INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, course_run_id, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, subtopic_id, course_run_id) DO NOTHING`,
        [userId, subtopicId, courseRunUuid]
      );
      console.log(`✅ Bookmark added/confirmed: subtopic ${subtopicId} in course run ${courseRunUuid}`);
    } else {
      // Remove bookmark
      const result = await pool.query(
        `DELETE FROM public.user_subtopic_bookmark
         WHERE user_id = $1 AND subtopic_id = $2 AND course_run_id = $3`,
        [userId, subtopicId, courseRunUuid]
      );
      console.log(`✅ Bookmark removed: subtopic ${subtopicId} in course run ${courseRunUuid}, affected rows: ${result.rowCount}`);
    }

    return res.status(200).json({ 
      success: true, 
      message: isBookmarked ? 'Bookmark added' : 'Bookmark removed' 
    });

  } catch (error) {
    console.error('💥 Error toggling bookmark:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}

export default withAuth(handler);
