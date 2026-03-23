import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Auto-create the trainer_assessment_grading table if it doesn't exist
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_assessment_grading (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      course_run_id UUID NOT NULL,
      learner_user_id UUID NOT NULL,
      grade VARCHAR(3) NOT NULL CHECK (grade IN ('C', 'NYC')),
      reason TEXT DEFAULT '',
      graded_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(course_run_id, learner_user_id)
    );
  `);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      // GET ?courseRunId=UUID — fetch all grades for a course run
      const { courseRunId } = req.query;
      if (!courseRunId) {
        return res.status(400).json({ success: false, error: 'courseRunId is required' });
      }

      const result = await pool.query(
        `SELECT tag.learner_user_id, tag.grade, tag.reason, tag.updated_at
         FROM trainer_assessment_grading tag
         WHERE tag.course_run_id = $1`,
        [courseRunId]
      );

      return res.status(200).json({ success: true, data: result.rows });
    }

    if (req.method === 'POST') {
      // POST — save/update grades for multiple learners
      const { courseRunId, grades, gradedBy } = req.body;
      // grades: Array<{ learnerUserId: string; grade: 'C' | 'NYC'; reason: string }>

      if (!courseRunId || !Array.isArray(grades)) {
        return res.status(400).json({ success: false, error: 'courseRunId and grades array required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const g of grades) {
          if (!g.learnerUserId || !g.grade) continue;
          await client.query(
            `INSERT INTO trainer_assessment_grading (course_run_id, learner_user_id, grade, reason, graded_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (course_run_id, learner_user_id)
             DO UPDATE SET grade = $3, reason = $4, graded_by = $5, updated_at = NOW()`,
            [courseRunId, g.learnerUserId, g.grade, g.reason || '', gradedBy || null]
          );
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Grades saved successfully' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Assessment grading error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}
