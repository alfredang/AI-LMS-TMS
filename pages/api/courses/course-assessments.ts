import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface AssessmentRow {
  id: string;
  title: string;
  category: string;
  file_url: string;
  deadline: string;
  status: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userId, courseRunId } = req.query;

    if (!userId || !courseRunId) {
      return res.status(400).json({ message: 'User ID and Course Run ID are required' });
    }

    // SQL query to get published assessments for a specific user and course run
    const assessmentsQuery = `
      SELECT
        a.id,
        a.title,
        a.category,
        a.file_url,
        cr.end_date as deadline,
        a.status
      FROM enrollment e
      JOIN course_run cr   ON cr.id = e.course_run_id
      JOIN course c        ON c.id = cr.course_id
      JOIN assessment a    ON a.course_id = cr.course_id
      WHERE e.user_id = $1
        AND cr.id = $2
        AND a.status = 'Published'
      ORDER BY cr.end_date NULLS LAST, a.title
    `;

    const result = await pool.query(assessmentsQuery, [userId, courseRunId]);

    const assessments = result.rows.map((row: AssessmentRow) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      file_url: row.file_url,
      deadline: row.deadline,
      status: row.status
    }));

    res.status(200).json({
      success: true,
      data: assessments
    });

  } catch (error) {
    console.error('Error fetching course assessments:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}
