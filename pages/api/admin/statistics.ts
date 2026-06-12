import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface AdminStatistics {
  ongoingClasses: number;
  upcomingClasses: number;
  completedClasses: number;
  assignedTrainersLocal: number;
  missingTrainersLocal: number;
  missingTrainersTPG: number;
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
          -- Ongoing classes (excludes Cancelled)
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.start_date <= CURRENT_DATE
             AND cr.end_date >= CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled') AS "ongoingClasses",

          -- Upcoming classes: start_date > today (excludes Cancelled)
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled') AS "upcomingClasses",

          -- Completed classes (excludes Cancelled)
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.end_date < CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled') AS "completedClasses",

          -- Assigned Trainers (Local) for Upcoming Classes
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled'
             AND cr.assigned_trainer_name IS NOT NULL
             AND cr.assigned_trainer_name != '') AS "assignedTrainersLocal",

          -- Missing Trainers (Local) for Upcoming Classes
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled'
             AND (cr.assigned_trainer_name IS NULL OR cr.assigned_trainer_name = '')) AS "missingTrainersLocal",

          -- Missing Trainers (TPG) for Upcoming Classes
          (SELECT COUNT(*)
           FROM course_run cr
           WHERE cr.start_date > CURRENT_DATE
             AND cr.class_status IS DISTINCT FROM 'Cancelled'
             AND (cr.tpg_assigned_trainer_name IS NULL OR cr.tpg_assigned_trainer_name = '')) AS "missingTrainersTPG"
    `;

    const result = await pool.query(statisticsQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No statistics found' });
    }

    const statistics: AdminStatistics = {
      ongoingClasses: parseInt(result.rows[0].ongoingClasses) || 0,
      upcomingClasses: parseInt(result.rows[0].upcomingClasses) || 0,
      completedClasses: parseInt(result.rows[0].completedClasses) || 0,
      assignedTrainersLocal: parseInt(result.rows[0].assignedTrainersLocal) || 0,
      missingTrainersLocal: parseInt(result.rows[0].missingTrainersLocal) || 0,
      missingTrainersTPG: parseInt(result.rows[0].missingTrainersTPG) || 0,
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