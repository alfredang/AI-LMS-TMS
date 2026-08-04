import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface AssessmentRow {
  id: string;
  title: string;
  category: string;
  file_url: string;
  status: string;
}

async function handler(
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
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    console.log('🔍 Developer Course Assessments API - CourseId:', courseId);

    // SQL query to get all assessments for a course (for developers to view)
    // This doesn't include published status since developers work at course level, not course run level
    const assessmentsQuery = `
      SELECT
        a.id,
        a.title,
        a.category,
        a.file_url,
        a.status
      FROM assessment a
      WHERE a.course_id = $1
      ORDER BY a.title
    `;

    const result = await pool.query(assessmentsQuery, [courseId]);

    console.log('📊 Developer Course Assessments - Query result:', result.rows);

    // Map the results to the expected format
    const assessments = result.rows.map((row: AssessmentRow) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      file_url: row.file_url,
      deadline: null, // No deadline for course-level assessments
      status: row.status,
      published: false // Course-level assessments don't have published status
    }));

    res.status(200).json({
      success: true,
      data: assessments
    });

  } catch (error) {
    console.error('❌ Developer course assessments API error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
