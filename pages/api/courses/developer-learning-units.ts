import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    // SQL query to get learning units and subtopics for developers
    const learningUnitsQuery = `
      SELECT 
          lu.id          AS learning_unit_id,
          lu.title       AS learning_unit_title,
          lu.position    AS learning_unit_position,
          st.id          AS subtopic_id,
          st.title       AS subtopic_title,
          st.position    AS subtopic_position
      FROM learning_unit lu
      LEFT JOIN subtopic st 
             ON lu.id = st.learning_unit_id
      WHERE lu.course_id = $1
      ORDER BY lu.position, st.position
    `;

    const result = await pool.query(learningUnitsQuery, [courseId]);

    // Group subtopics under their learning units
    const learningUnitsMap = new Map();
    
    result.rows.forEach((row: any) => {
      const unitId = row.learning_unit_id;
      
      if (!learningUnitsMap.has(unitId)) {
        learningUnitsMap.set(unitId, {
          id: unitId,
          title: row.learning_unit_title,
          position: row.learning_unit_position,
          subtopics: []
        });
      }
      
      // Add subtopic if it exists
      if (row.subtopic_id) {
        learningUnitsMap.get(unitId).subtopics.push({
          id: row.subtopic_id,
          title: row.subtopic_title,
          position: row.subtopic_position
        });
      }
    });

    // Convert to array and sort by position
    const learningUnits = Array.from(learningUnitsMap.values())
      .sort((a, b) => a.position - b.position)
      .map(unit => ({
        ...unit,
        subtopics: unit.subtopics.sort((a: any, b: any) => a.position - b.position)
      }));

    res.status(200).json({
      success: true,
      data: learningUnits
    });

  } catch (error) {
    console.error('❌ Developer learning units API error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
