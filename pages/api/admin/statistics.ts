import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface AdminStatistics {
  totalLearners: number;
  totalTrainers: number;
  ongoingClasses: number;
  classesNext7Days: number;
  classesNext30Days: number;
  completedClasses: number;
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
    const statisticsQuery = `
      SELECT 
          -- Total unique learners
          (SELECT COUNT(DISTINCT lp.user_id)
           FROM learner_profile lp) AS "totalLearners",

          -- Total unique trainers
          (SELECT COUNT(DISTINCT tp.user_id)
           FROM trainer_profile tp) AS "totalTrainers",

          -- Ongoing classes
          (SELECT COUNT(*) 
           FROM course_run cr
           WHERE cr.start_date <= CURRENT_DATE
             AND cr.end_date >= CURRENT_DATE) AS "ongoingClasses",

          -- Classes starting within next 7 days
          (SELECT COUNT(*) 
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.start_date <= CURRENT_DATE + INTERVAL '7 days') AS "classesNext7Days",

          -- Classes starting within next 30 days
          (SELECT COUNT(*) 
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.start_date <= CURRENT_DATE + INTERVAL '30 days') AS "classesNext30Days",

          -- Completed classes
          (SELECT COUNT(*) 
           FROM course_run cr
           WHERE cr.end_date < CURRENT_DATE) AS "completedClasses"
    `;

    const result = await pool.query(statisticsQuery);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No statistics found' });
    }

    const statistics: AdminStatistics = {
      totalLearners: parseInt(result.rows[0].totalLearners) || 0,
      totalTrainers: parseInt(result.rows[0].totalTrainers) || 0,
      ongoingClasses: parseInt(result.rows[0].ongoingClasses) || 0,
      classesNext7Days: parseInt(result.rows[0].classesNext7Days) || 0,
      classesNext30Days: parseInt(result.rows[0].classesNext30Days) || 0,
      completedClasses: parseInt(result.rows[0].completedClasses) || 0,
    };

    res.status(200).json({
      success: true,
      data: statistics
    });

  } catch (error) {
    console.error('Error fetching admin statistics:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}