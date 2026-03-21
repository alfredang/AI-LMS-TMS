import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface LearningUnitRow {
  learning_unit_id: string;
  learning_unit_title: string;
  learning_unit_position: number;
  subtopic_id: string;
  subtopic_title: string;
  subtopic_position: number;
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

    // SQL query to get learning units and subtopics for a specific user and course run
    const learningUnitsQuery = `
      SELECT
        lu.id          AS learning_unit_id,
        lu.title       AS learning_unit_title,
        lu.position    AS learning_unit_position,
        st.id          AS subtopic_id,
        st.title       AS subtopic_title,
        st.position    AS subtopic_position
      FROM enrollment e
      JOIN course_run cr 
        ON e.course_run_id = cr.id
      JOIN course c 
        ON cr.course_id = c.id
      JOIN learning_unit lu
        ON c.id = lu.course_id
      LEFT JOIN subtopic st
        ON lu.id = st.learning_unit_id
      JOIN learner_profile l
        ON e.user_id = l.user_id
      WHERE l.user_id = $1
        AND cr.id = $2
      ORDER BY lu.position, st.position
    `;

    const result = await pool.query(learningUnitsQuery, [userId, courseRunId]);

    // Group the results by learning unit
    const learningUnitsMap = new Map();
    
    result.rows.forEach((row: LearningUnitRow) => {
      if (!learningUnitsMap.has(row.learning_unit_id)) {
        learningUnitsMap.set(row.learning_unit_id, {
          id: row.learning_unit_id,
          title: row.learning_unit_title,
          position: row.learning_unit_position,
          subtopics: []
        });
      }

      if (row.subtopic_title) {
        learningUnitsMap.get(row.learning_unit_id).subtopics.push({
          id: row.subtopic_id,
          title: row.subtopic_title,
          position: row.subtopic_position
        });
      }
    });

    const learningUnits = Array.from(learningUnitsMap.values());

    res.status(200).json({
      success: true,
      data: learningUnits
    });

  } catch (error) {
    console.error('Error fetching learning units:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}
