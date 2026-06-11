import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { triggerClassCalendarSync } from '@lib/calendar/triggerClassCalendarSync';

/**
 * External API — Enrollments
 *
 * GET  /api/external/enrollments  — list enrollments (with filters)
 * POST /api/external/enrollments  — enroll a learner into a course run
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * GET query params (all optional):
 *   course_run_id, course_code, learner_email, payment_status, limit, offset
 *
 * POST body (JSON):
 *   {
 *     "course_run_id": "1334264",
 *     "learner_email": "jane@example.com",    (or "learner_id": "<uuid>")
 *     "sponsorship_type": "Individual",        (optional — "Individual" | "Employer", default "Individual")
 *     "payment_status": "Unpaid",              (optional — "Paid" | "Unpaid", default "Unpaid")
 *     "enrolment_status": "Confirmed"          (optional — default "Confirmed")
 *   }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { course_run_id, course_code, learner_email, payment_status } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (course_run_id) {
      conditions.push(`cr.course_run_id = $${idx++}`);
      params.push(String(course_run_id));
    }
    if (course_code) {
      conditions.push(`c.course_code = $${idx++}`);
      params.push(String(course_code));
    }
    if (learner_email) {
      conditions.push(`LOWER(u.email) = LOWER($${idx++})`);
      params.push(String(learner_email));
    }
    if (payment_status) {
      conditions.push(`e.payment_status = $${idx++}`);
      params.push(String(payment_status));
    }

    // Exclude inactive enrollments
    conditions.push(`LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         e.id AS enrollment_id,
         e.enrolment_id AS ssg_enrolment_id,
         e.enrolment_status,
         e.enrolment_date,
         e.payment_status,
         e.assessment_status,
         e.course_sponsorship,
         e.progress_percent,
         e.nric,
         e.grant_id,
         e.grant_amount,
         e.completion_date,
         u.full_name AS learner_name,
         u.email AS learner_email,
         c.title AS course_title,
         c.course_code,
         c.course_fee,
         cr.course_run_id,
         cr.start_date AS course_run_start,
         cr.end_date AS course_run_end,
         cr.class_status,
         cr.assigned_trainer_name
       FROM enrollment e
       LEFT JOIN app_user u ON u.id = e.user_id
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = e.course_id
       ${where}
       ORDER BY e.enrolment_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM enrollment e
       LEFT JOIN app_user u ON u.id = e.user_id
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = e.course_id
       ${where}`,
      params
    );

    return res.status(200).json({
      success: true,
      total: countResult.rows[0].total,
      limit,
      offset,
      data: result.rows,
    });
  } catch (error) {
    console.error('external/enrollments GET error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const {
    course_run_id,
    learner_email,
    learner_id,
    sponsorship_type = 'Individual',
    payment_status = 'Unpaid',
    enrolment_status = 'Confirmed',
  } = req.body ?? {};

  if (!course_run_id) {
    return res.status(400).json({ success: false, error: 'course_run_id is required' });
  }
  if (!learner_email && !learner_id) {
    return res.status(400).json({ success: false, error: 'learner_email or learner_id is required' });
  }

  try {
    // Resolve course run
    const crResult = await pool.query(
      `SELECT cr.id, cr.course_id, cr.course_run_id
       FROM course_run cr
       WHERE cr.course_run_id = $1`,
      [String(course_run_id)]
    );
    if (crResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Course run ${course_run_id} not found` });
    }
    const courseRun = crResult.rows[0];

    // Resolve learner
    let userId: string | null = learner_id || null;
    let learnerEmail = learner_email ? learner_email.trim().toLowerCase() : null;

    if (!userId && learnerEmail) {
      const userResult = await pool.query(
        `SELECT id, email FROM app_user WHERE LOWER(email) = $1`,
        [learnerEmail]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Learner with email ${learner_email} not found. Create the learner first via POST /api/external/learners.`,
        });
      }
      userId = userResult.rows[0].id;
      learnerEmail = userResult.rows[0].email;
    }

    if (userId && !learnerEmail) {
      const userResult = await pool.query(`SELECT email FROM app_user WHERE id = $1`, [userId]);
      if (userResult.rows.length > 0) learnerEmail = userResult.rows[0].email;
    }

    // Create enrollment (upsert)
    const result = await pool.query(
      `INSERT INTO enrollment (
         user_id, course_id, course_run_id,
         enrolment_date, enrolment_status,
         course_sponsorship, payment_status, assessment_status,
         email, progress_percent
       ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5::public.course_sponsorship, $6::public.learner_payment_status, 'Pending', $7, 0)
       ON CONFLICT (user_id, course_run_id) DO UPDATE SET
         enrolment_status = EXCLUDED.enrolment_status,
         course_sponsorship = EXCLUDED.course_sponsorship,
         payment_status = EXCLUDED.payment_status,
         updated_at = NOW()
       RETURNING id, enrolment_date, enrolment_status, course_sponsorship, payment_status`,
      [userId, courseRun.course_id, courseRun.id, enrolment_status, sponsorship_type, payment_status, learnerEmail]
    );

    const enrollment = result.rows[0];

    // Calendar: enrollment changed -> reconcile the class event/attendees.
    // (Re-evaluates the whole run, so safe regardless of this row's status.)
    triggerClassCalendarSync(courseRun.id);

    return res.status(201).json({
      success: true,
      message: `Learner enrolled in course run ${course_run_id}`,
      data: {
        enrollment_id: enrollment.id,
        course_run_id,
        learner_id: userId,
        learner_email: learnerEmail,
        enrolment_date: enrollment.enrolment_date,
        enrolment_status: enrollment.enrolment_status,
        sponsorship_type: enrollment.course_sponsorship,
        payment_status: enrollment.payment_status,
      },
    });
  } catch (error) {
    console.error('external/enrollments POST error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
