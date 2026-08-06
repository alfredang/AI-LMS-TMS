import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

type TrainerCalendarEvent = {
  id: string;
  title: string;
  type: 'quiz' | 'assignment' | 'lecture' | 'grading' | 'class';
  date: string;
  course_title: string;
  category: string;
  status: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply CORS middleware
  if (cors(req, res)) {
    return; // Preflight handled
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { trainerId } = req.query;

  if (!trainerId) {
    return res.status(400).json({ error: 'Trainer ID is required' });
  }

  try {
    console.log(`[Trainer Calendar API] Fetching calendar events for trainer: ${trainerId}`);

    // SQL query to get trainer tasks/calendar events
    const query = `
    SELECT DISTINCT
        'assessment-' || a.id AS id,
        'Assessment: ' || a.title AS title,
        'assignment' AS type,
        cr.end_date AS date,
        c.title AS course_title,
        a.category::text AS category,
        a.status::text AS status,
        'Review submissions and provide grades' AS description,
        CASE 
            WHEN cr.end_date < NOW() THEN 'high'  -- already excluded below, but kept for priority logic
            WHEN cr.end_date < NOW() + INTERVAL '7 days' THEN 'medium'
            ELSE 'low'
        END AS priority
    FROM course_run cr
    JOIN course c ON cr.course_id = c.id
    JOIN assessment a ON c.id = a.course_id
    WHERE (
        cr.assigned_trainer_id = $1
        OR cr.tpg_assigned_trainer_id = $1
        OR EXISTS (
            SELECT 1 FROM course_run_trainer crt
            WHERE crt.course_run_id = cr.id AND crt.trainer_id = $1
        )
    )
    AND cr.end_date IS NOT NULL
    AND cr.end_date >= NOW()

    UNION ALL

    SELECT DISTINCT
        'class-' || cr.id AS id,
        'Class: ' || c.title AS title,
        'lecture' AS type,
        cr.start_date AS date,
        c.title AS course_title,
        'Class Session' AS category,
        CASE 
            WHEN cr.start_date > NOW() THEN 'upcoming'
            WHEN cr.start_date <= NOW() AND cr.end_date >= NOW() THEN 'ongoing'
            ELSE 'completed'
        END AS status,
        'Conduct training session' AS description,
        CASE 
            WHEN cr.start_date <= NOW() + INTERVAL '1 day' THEN 'high'
            WHEN cr.start_date <= NOW() + INTERVAL '3 days' THEN 'medium'
            ELSE 'low'
        END AS priority
    FROM course_run cr
    JOIN course c ON cr.course_id = c.id
    WHERE (
        cr.assigned_trainer_id = $1
        OR cr.tpg_assigned_trainer_id = $1
        OR EXISTS (
            SELECT 1 FROM course_run_trainer crt
            WHERE crt.course_run_id = cr.id AND crt.trainer_id = $1
        )
    )
    AND cr.end_date >= NOW()

    ORDER BY date ASC;
    `;

    const result = await pool.query(query, [trainerId]);

    // Transform database results to match CalendarEvent interface
    const calendarEvents = result.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      date: row.date,
      course_title: row.course_title,
      category: row.category,
      status: row.status,
      description: row.description,
      priority: row.priority
    }));

    console.log(`[Trainer Calendar API] Found ${calendarEvents.length} events for trainer ${trainerId}`);
    console.log(`[Trainer Calendar API] Sample data:`, calendarEvents.slice(0, 2));

    res.status(200).json({ 
      success: true, 
      data: calendarEvents,
      count: calendarEvents.length 
    });

  } catch (error) {
    console.error('[Trainer Calendar API] Database error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch trainer calendar events',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);
