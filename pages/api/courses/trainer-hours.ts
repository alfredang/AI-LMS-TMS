import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/courses/trainer-hours?trainerId=xxx&startDate=2026-01-01&endDate=2026-12-31
 *
 * Returns all completed course runs for a trainer within a date range,
 * with training and assessment hours for cumulative tracking.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { trainerId, startDate, endDate } = req.query;

  if (!trainerId) {
    return res.status(400).json({ success: false, error: 'trainerId is required' });
  }

  try {
    const fromDate = (startDate as string) || '2026-01-01';
    const toDate = (endDate as string) || new Date().toISOString().slice(0, 10);

    const result = await pool.query(
      `SELECT
          c.id AS course_id,
          c.title AS course_title,
          c.course_code,
          c.course_type,
          c.training_hours,
          c.assessment_hours,
          cr.id AS course_run_id,
          cr.course_run_id AS course_run_code,
          cr.start_date,
          cr.end_date
       FROM course_run cr
       JOIN course c ON cr.course_id = c.id
       WHERE (
         cr.assigned_trainer_id = $1
         OR EXISTS (
           SELECT 1 FROM course_run_trainer crt
           WHERE crt.course_run_id = cr.id AND crt.trainer_id = $1
         )
       )
       AND cr.end_date IS NOT NULL
       AND cr.end_date <= CURRENT_DATE
       AND cr.start_date >= $2::date
       AND cr.end_date <= $3::date
       ORDER BY cr.end_date DESC`,
      [trainerId, fromDate, toDate]
    );

    const courses = result.rows.map((row: any) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code,
      courseType: row.course_type,
      trainingHours: Number(row.training_hours) || 0,
      assessmentHours: Number(row.assessment_hours) || 0,
      courseRunId: row.course_run_id,
      courseRunCode: row.course_run_code,
      startDate: row.start_date,
      endDate: row.end_date,
    }));

    const totalTrainingHours = courses.reduce((sum: number, c: any) => sum + c.trainingHours, 0);
    const totalAssessmentHours = courses.reduce((sum: number, c: any) => sum + c.assessmentHours, 0);

    return res.status(200).json({
      success: true,
      data: courses,
      summary: {
        totalCourses: courses.length,
        totalTrainingHours,
        totalAssessmentHours,
        totalHours: totalTrainingHours + totalAssessmentHours,
      },
    });
  } catch (error) {
    console.error('Error fetching trainer hours:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
