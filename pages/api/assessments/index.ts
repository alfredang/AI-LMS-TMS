import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

type Assessment = {
  id: string;
  title: string;
  type: 'quiz' | 'assignment' | 'lecture';
  date: string;
  course_title: string;
  assessment_category: string;
  assessment_status: string;
  file_url: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {

    // SQL query to get all assessments for courses that a learner is enrolled in
    const query = `
      SELECT 
          c.title AS course_title,
          a.id AS assessment_id,
          a.title AS assessment_title,
          a.category AS assessment_category,
          a.status AS assessment_status,
          cr.end_date AS assessment_deadline,
          a.file_url AS assessment_file_url
      FROM app_user u
      JOIN enrollment e ON u.id = e.user_id
      JOIN course c ON e.course_id = c.id
      JOIN course_run cr ON e.course_run_id = cr.id
      JOIN assessment a ON c.id = a.course_id
      WHERE u.id = $1
      ORDER BY c.title, cr.end_date;
    `;

    const result = await pool.query(query, [userId]);

    // Transform database results to match CalendarEvent interface
    const assessments = result.rows.map((row: any) => ({
      id: row.assessment_id,
      title: row.assessment_title,
      type: row.assessment_category === 'quiz' ? 'quiz' : 
            row.assessment_category === 'assignment' ? 'assignment' : 'lecture',
      date: row.assessment_deadline,
      course_title: row.course_title,
      assessment_category: row.assessment_category,
      assessment_status: row.assessment_status,
      file_url: row.assessment_file_url
    }));


    res.status(200).json({ 
      success: true, 
      data: assessments,
      count: assessments.length 
    });

  } catch (error) {
    console.error('[Assessment API] Database error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch assessments',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
