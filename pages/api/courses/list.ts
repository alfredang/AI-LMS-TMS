import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await pool.connect();
    
    const query = `
      SELECT
        c.id,
        c.title,
        c.course_code,
        c.tsc_title,
        c.tsc_code,
        (SELECT ARRAY_AGG(cr.course_run_id) FROM course_run cr WHERE cr.course_id = c.id) AS course_run_ids
      FROM course c
      ORDER BY c.created_at DESC;
    `;

    const result = await client.query(query);
    client.release();

    const courses = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      courseCode: row.course_code,
      tscTitle: row.tsc_title,
      tscCode: row.tsc_code,
      courseRunIds: row.course_run_ids || [],
    }));

    res.status(200).json({ 
      success: true, 
      data: courses 
    });
  } catch (error: any) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch courses', 
      details: error.message 
    });
  }
}