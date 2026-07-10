import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseId } = req.query;

    if (!courseId || typeof courseId !== 'string') {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    // Query to get all course runs for a specific course (excluding deleted ones)
    const courseRuns = await pool.query(
      `SELECT
        course_run_id,
        start_date::text AS start_date
      FROM
        course_run
      WHERE
        course_id = $1
        AND (is_deleted IS NULL OR is_deleted = false)
      ORDER BY course_run_id DESC`,
      [courseId]
    );

    res.status(200).json({
      success: true,
      data: courseRuns.rows
    });
  } catch (error) {
    console.error('Error fetching course runs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}