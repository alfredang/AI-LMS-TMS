import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

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
        id,
        title,
        course_code,
        tsc_title,
        tsc_code
      FROM course
      ORDER BY created_at DESC;
    `;

    const result = await client.query(query);
    client.release();

    const courses = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      courseCode: row.course_code,
      tscTitle: row.tsc_title,
      tscCode: row.tsc_code
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