import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { courseRunId } = req.body;

    console.log('🔍 Delete course run API called with:', { courseRunId });

    if (!courseRunId) {
      return res.status(400).json({
        success: false,
        error: 'Course Run ID is required'
      });
    }

    // First check if course run exists in course_run table and get course details
    const checkResult = await pool.query(
      `SELECT cr.id, cr.course_run_id, cr.is_deleted, c.course_code 
       FROM course_run cr
       JOIN course c ON cr.course_id = c.id
       WHERE cr.course_run_id = $1`,
      [courseRunId]
    );

    console.log('🔍 Check result:', checkResult.rows);

    if (checkResult.rows.length === 0) {
      console.log('❌ Course run not found in database');
      return res.status(404).json({
        success: false,
        error: 'Course run not found in database'
      });
    }

    const courseRun = checkResult.rows[0];
    console.log('✅ Course run found, current is_deleted status:', courseRun.is_deleted);

    // Ensure is_deleted column exists (auto-migration)
    await pool.query(`
      ALTER TABLE public.course_run
      ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
    `);

    console.log('🔍 Attempting to update is_deleted to true...');

    // Update is_deleted to true for matching course run
    const result = await pool.query(
      `UPDATE course_run SET is_deleted = true, updated_at = NOW() WHERE course_run_id = $1 RETURNING id, course_run_id, is_deleted`,
      [courseRunId]
    );

    console.log(`✅ Update result:`, result.rows[0]);
    console.log(`✅ Rows affected:`, result.rowCount);

    console.log(`✅ Marked course run ${courseRunId} as deleted`);

    return res.status(200).json({
      success: true,
      data: {
        courseReferenceNumber: courseRun.course_code,
        courseRunId: courseRun.course_run_id,
        isDeleted: true
      }
    });
  } catch (error: any) {
    console.error('❌ Error deleting course run:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
