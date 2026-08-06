import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { title, courseCode, courseType, tscTitle, tscCode, trainingHours, assessmentHours } = req.body;

  if (!title || !courseCode) {
    return res.status(400).json({ success: false, error: 'title and courseCode are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO course (title, course_code, course_type, tsc_title, tsc_code, training_hours, assessment_hours, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (course_code) DO NOTHING
       RETURNING id`,
      [
        title.trim(),
        courseCode.trim(),
        courseType || 'Non-WSQ',
        tscTitle?.trim() || null,
        tscCode?.trim() || null,
        parseFloat(trainingHours) || 0,
        parseFloat(assessmentHours) || 0,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: `A course with code "${courseCode}" already exists.` });
    }

    return res.status(200).json({ success: true, message: 'Course added successfully', id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
