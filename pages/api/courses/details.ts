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

  const { courseId } = req.query;

  if (!courseId || typeof courseId !== 'string') {
    return res.status(400).json({ error: 'Course ID is required' });
  }

  try {
    const client = await pool.connect();
    
    const query = `
      SELECT 
        c.id,
        c.title,
        c.tsc_title,
        c.tsc_knowledge,
        c.tsc_abilities,
        c.learning_outcomes
      FROM course c
      WHERE c.id = $1;
    `;

    const result = await client.query(query, [courseId]);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Course not found' 
      });
    }

    const course = result.rows[0];
    const courseDetails = {
      id: course.id,
      title: course.title,
      tscTitle: course.tsc_title,
      tscKnowledge: course.tsc_knowledge,
      tscAbilities: course.tsc_abilities,
      learningOutcomes: course.learning_outcomes
    };

    res.status(200).json({ 
      success: true, 
      data: courseDetails 
    });
  } catch (error: any) {
    console.error('Error fetching course details:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch course details', 
      details: error.message 
    });
  }
}
