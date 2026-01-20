import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface AssessmentRow {
  id: string;
  title: string;
  category: string;
  file_url: string;
  deadline: string;
  status: string;
  published: boolean;
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
    const { courseRunId } = req.query;

    if (!courseRunId) {
      return res.status(400).json({ message: 'Course Run ID is required' });
    }

    console.log('🔍 Developer Assessments API - CourseRunId:', courseRunId);

    // SQL query to get all assessments for a course run (for developers to manage)
    const assessmentsQuery = `
      SELECT
        a.id,
        a.title,
        a.category,
        a.file_url,
        cr.end_date as deadline,
        a.status,
        COALESCE(cra.published, false) as published
      FROM course_run cr
      JOIN course_run_assessment cra ON cra.course_run_id = cr.id
      JOIN assessment a ON a.id = cra.assessment_id
      WHERE cr.id = $1
      ORDER BY a.title
    `;

    const result = await pool.query(assessmentsQuery, [courseRunId]);

    console.log('📊 Developer Assessments - Query result:', result.rows);

    const assessments = result.rows.map((row: AssessmentRow) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      file_url: row.file_url,
      deadline: row.deadline,
      status: row.status,
      published: row.published
    }));

    console.log('✅ Developer Assessments - Formatted assessments:', assessments);

    res.status(200).json({
      success: true,
      data: assessments
    });

  } catch (error) {
    console.error('❌ Error fetching developer assessments:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}