import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // SQL query to get only courses for developer management (no course runs)
    const sqlQuery = `
      SELECT 
          c.id AS course_id,
          c.title AS course_title,
          c.course_code,
          c.tsc_title,
          c.tsc_code,
          c.course_type,
          c.image_url AS course_image,
          c.training_hours,
          c.assessment_hours,
          c.mode_of_learning,
          c.funding_validity
      FROM course c
      ORDER BY c.title
    `;

    const result = await pool.query(sqlQuery);

    // Transform the data to match the frontend Course interface (without course run data)
    const courses = result.rows.map((row: any) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code || '', 
      courseDuration: (row.training_hours || 0) + (row.assessment_hours || 0),
      trainingHours: row.training_hours || 0,
      assessmentHours: row.assessment_hours || 0,
      courseType: row.course_type,
      tscTitle: row.tsc_title || '',
      tscCode: row.tsc_code || '',
      imageUrl: row.course_image || null,
      modeOfLearning: row.mode_of_learning ? [row.mode_of_learning] : ['Hybrid'],
      fundingValidity: row.funding_validity || null,
      courseRunId: null, // No course run for developers
      startDate: null,   // No start date for developers
      endDate: null,     // No end date for developers
      classStatus: 'Published', // Default status for developers
      topics: [] // Empty topics for now
    }));

    console.log('📊 Developer courses endpoint - returning', courses.length, 'courses');
    
    return res.status(200).json(courses);

  } catch (error: any) {
    console.error('❌ Developer courses endpoint error:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch courses', 
      error: error.message 
    });
  }
}