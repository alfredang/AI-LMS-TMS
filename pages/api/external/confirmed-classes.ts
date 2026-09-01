import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { resolveClassDurationDays } from '../../../lib/trainerInvitations';
import { normalizeSgPhone } from '../../../lib/trainerWhatsapp';

/**
 * External API — Confirmed Classes (authoritative feed for trainer reminders)
 *
 * Built for Tael's "upcoming class reminder to trainers, 3 days in advance"
 * job. Tael previously assembled class info itself (calendar scraping / fuzzy
 * matching), which produced wrong or blank fields (Course Duration, Mode of
 * Training…). This endpoint returns the LMS's OWN record — the single source
 * of truth — for every class that is:
 *
 *   - class_status = 'Confirmed', AND
 *   - has at least one trainer assigned in the LMS (course_run_trainer)
 *
 * Every field the reminder template needs is included, plus each trainer's
 * E.164 phone so no further lookups are required.
 *
 * GET /api/external/confirmed-classes?days_ahead=3
 *   → classes starting exactly N days from today (SGT). Default 3.
 * GET /api/external/confirmed-classes?start_date=YYYY-MM-DD
 *   → classes starting on that date.
 * GET /api/external/confirmed-classes?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → classes starting in the range (inclusive), max 62 days.
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function buildVenueString(row: any): string | null {
  const parts = [
    row.venue_building,
    row.venue_block ? `Blk ${row.venue_block}` : null,
    row.venue_street,
    row.venue_floor && row.venue_unit ? `#${row.venue_floor}-${row.venue_unit}` : row.venue_floor || row.venue_unit,
    row.venue_room ? `Room ${row.venue_room}` : null,
    row.venue_postal_code ? `S(${row.venue_postal_code})` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function normalizeMode(row: any): string {
  const raw = String(row.class_type || row.mode_of_learning || '');
  if (/virtual/i.test(raw)) return 'Virtual';
  if (/hybrid/i.test(raw)) return 'Hybrid';
  if (/external/i.test(raw)) return 'External';
  return 'Classroom';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    // Resolve the date window (SGT).
    const { start_date, from, to } = req.query;
    let fromExpr: string;
    let toExpr: string;
    const params: any[] = [];
    if (typeof from === 'string' || typeof to === 'string') {
      if (typeof from !== 'string' || !ISO_DATE.test(from) || typeof to !== 'string' || !ISO_DATE.test(to)) {
        return res.status(400).json({ success: false, error: 'from and to must both be YYYY-MM-DD' });
      }
      const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
      if (span < 0 || span > 62) {
        return res.status(400).json({ success: false, error: 'from..to must be a forward range of at most 62 days' });
      }
      params.push(from, to);
      fromExpr = `$1::date`;
      toExpr = `$2::date`;
    } else if (typeof start_date === 'string') {
      if (!ISO_DATE.test(start_date)) {
        return res.status(400).json({ success: false, error: 'start_date must be YYYY-MM-DD' });
      }
      params.push(start_date);
      fromExpr = `$1::date`;
      toExpr = `$1::date`;
    } else {
      const daysAhead = Math.min(Math.max(parseInt(String(req.query.days_ahead || '3'), 10) || 3, 0), 62);
      params.push(daysAhead);
      fromExpr = `(NOW() AT TIME ZONE 'Asia/Singapore')::date + ($1::int * INTERVAL '1 day')`;
      toExpr = fromExpr;
    }

    const result = await pool.query(
      `SELECT
          cr.id AS course_run_uuid,
          cr.course_run_id,
          cr.start_date::date::text AS start_date,
          cr.end_date::date::text AS end_date,
          cr.class_status,
          cr.class_type,
          cr.mode_of_learning::text AS mode_of_learning,
          cr.virtual_meeting_link,
          cr.digital_attendance_id,
          cr.venue_block, cr.venue_street, cr.venue_building, cr.venue_floor,
          cr.venue_unit, cr.venue_postal_code, cr.venue_room,
          c.title AS course_title,
          c.course_code,
          c.training_hours,
          c.assessment_hours,
          c.num_of_days,
          (SELECT COUNT(DISTINCT cs.start_date)::int
             FROM course_session cs
            WHERE cs.course_run_id = cr.id
              AND COALESCE(cs.deleted, false) = false
              AND cs.start_date IS NOT NULL) AS session_days,
          (SELECT COALESCE(json_agg(json_build_object(
                    'date', (s.start_date::date)::text,
                    'startTime', s.start_time,
                    'endTime', s.end_time
                  ) ORDER BY s.start_date, s.start_time), '[]'::json)
             FROM (SELECT DISTINCT cs.start_date, cs.start_time, cs.end_time
                     FROM course_session cs
                    WHERE cs.course_run_id = cr.id
                      AND COALESCE(cs.deleted, false) = false
                      AND cs.start_date IS NOT NULL) s) AS sessions,
          (SELECT COUNT(*)::int FROM enrollment e
            WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed') AS learner_count,
          (SELECT COALESCE(json_agg(json_build_object(
                    'name', t.trainer_name,
                    'email', t.trainer_email,
                    'tel', tp.tel
                  ) ORDER BY t.assigned_at), '[]'::json)
             FROM course_run_trainer t
             LEFT JOIN app_user au
               ON (t.trainer_id IS NOT NULL AND au.id = t.trainer_id)
               OR (t.trainer_id IS NULL AND LOWER(au.email) = LOWER(t.trainer_email))
             LEFT JOIN trainer_profile tp ON tp.user_id = au.id
            WHERE t.course_run_id = cr.id) AS trainers
        FROM course_run cr
        JOIN course c ON c.id = cr.course_id
       WHERE cr.class_status = 'Confirmed'
         AND cr.start_date::date >= ${fromExpr}
         AND cr.start_date::date <= ${toExpr}
         AND EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
       ORDER BY cr.start_date ASC, c.title ASC`,
      params
    );

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

    const classes = result.rows.map((row: any) => {
      const { label: durationLabel } = resolveClassDurationDays(row);
      const trainingVal = Number(row.training_hours) || 0;
      const assessmentVal = Number(row.assessment_hours) || 0;
      const hours = trainingVal + assessmentVal;
      // Dedupe trainers by lowercased email (junction rows can repeat a person).
      const seen = new Set<string>();
      const trainers = (row.trainers || []).flatMap((t: any) => {
        const key = String(t.email || t.name || '').toLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [{
          name: t.name,
          email: t.email || null,
          phone_e164: normalizeSgPhone(t.tel),
        }];
      });
      return {
        course_run_id: row.course_run_id,
        course_title: row.course_title,
        course_code: row.course_code,
        class_status: row.class_status,
        start_date: row.start_date,
        end_date: row.end_date,
        duration_label: durationLabel,
        course_hours: hours > 0 ? `${hours} hours` : null,
        mode_of_training: normalizeMode(row),
        virtual_meeting_link: row.virtual_meeting_link || null,
        venue: buildVenueString(row),
        e_attendance_url: row.digital_attendance_id
          ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${row.digital_attendance_id}`
          : null,
        lms_login_url: baseUrl ? `${baseUrl}/` : 'https://lms-tms.tertiaryinfotech.com/',
        learner_count: row.learner_count,
        sessions: row.sessions || [],
        trainers,
      };
    });

    return res.status(200).json({ success: true, count: classes.length, classes });
  } catch (err) {
    console.error('❌ [confirmed-classes] failed:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default handler;
