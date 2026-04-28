import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Trainer Reminders
 *
 * GET /api/external/trainer-reminders
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params:
 *   start_date       — required, ISO date YYYY-MM-DD
 *   end_date         — required, ISO date YYYY-MM-DD
 *   status           — optional, default "Confirmed"
 *   send_reminder    — optional, "true" to filter only eligible runs
 *   include_virtual  — optional, "true" to include virtual classes (default true)
 *   include_external — optional, "true" to include external classes (default true)
 *
 * GET /api/external/trainer-reminders?course_run_id=1322708
 *   — fetch a single course run's trainer reminder data
 */

function formatPhone(tel: string | null): string | null {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, '');
  if (!digits) return null;
  // Already has country code
  if (digits.startsWith('65') && digits.length === 10) return `+${digits}`;
  // Singapore 8-digit number
  if (digits.length === 8) return `+65${digits}`;
  // Already full international
  if (tel.startsWith('+')) return tel;
  return `+${digits}`;
}

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

function computeDurationLabel(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
  if (days <= 1) return '1 day';
  return `${days} days`;
}

function mapRow(row: any) {
  const phone = formatPhone(row.trainer_tel);
  const isVirtual = row.mode_of_learning === 'Virtual';
  const isExternal = row.mode_of_learning === 'External';

  return {
    course_run_id: row.course_run_id,
    course_code: row.course_code,
    course_title: row.course_title,
    start_date: row.start_date,
    end_date: row.end_date,
    duration_label: computeDurationLabel(row.start_date, row.end_date),
    mode_of_training: row.mode_of_learning || 'Physical',
    trainer: {
      trainer_id: row.trainer_id || null,
      name: row.trainer_name,
      phone_e164: phone,
      email: row.trainer_email || null,
    },
    lms_login_url: (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/',
    e_attendance_url: row.digital_attendance_id
      ? `${(process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/e-attendance/${row.course_run_id}`
      : null,
    google_meet_url: null,
    venue: buildVenueString(row),
    status: row.class_status,
    is_virtual: isVirtual,
    is_external: isExternal,
    send_reminder: !!phone,
    remarks: null,
    attendance_code: row.digital_attendance_id || null,
    calendar_event_url: null,
    last_reminder_sent_at: null,
    reminder_sent_count: 0,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } });

  // Auth: support both x-api-key and Bearer token
  const apiKey = req.headers['x-api-key'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ error: { code: 'internal_error', message: 'API key not configured on server' } });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid or missing API key' } });

  const { course_run_id, start_date, end_date, status, send_reminder, include_virtual, include_external } = req.query;

  // Single course run lookup
  if (course_run_id) {
    return handleSingleRun(String(course_run_id), res);
  }

  // Upcoming reminders — require date range
  if (!start_date || !end_date) {
    return res.status(400).json({ error: { code: 'validation_error', message: 'start_date and end_date are required (YYYY-MM-DD)' } });
  }

  try {
    const conditions: string[] = [
      `cr.start_date >= $1`,
      `cr.end_date <= $2`,
      `crt.trainer_name IS NOT NULL`,
    ];
    const params: (string | number)[] = [String(start_date), String(end_date)];
    let idx = 3;

    // Default to Confirmed if not specified
    const classStatus = status || 'Confirmed';
    conditions.push(`cr.class_status = $${idx++}`);
    params.push(String(classStatus));

    // Exclude modes if not requested
    if (include_virtual === 'false') {
      conditions.push(`cr.mode_of_learning != 'Virtual'`);
    }
    if (include_external === 'false') {
      conditions.push(`cr.mode_of_learning != 'External'`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
         cr.course_run_id,
         cr.start_date,
         cr.end_date,
         cr.mode_of_learning,
         cr.class_status,
         cr.digital_attendance_id,
         cr.venue_block,
         cr.venue_street,
         cr.venue_building,
         cr.venue_floor,
         cr.venue_unit,
         cr.venue_postal_code,
         cr.venue_room,
         c.course_code,
         c.title AS course_title,
         crt.trainer_id,
         crt.trainer_name,
         crt.trainer_email,
         tp.tel AS trainer_tel
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       JOIN course_run_trainer crt ON crt.course_run_id = cr.id
       LEFT JOIN trainer_profile tp ON tp.user_id = crt.trainer_id
       ${where}
       ORDER BY cr.start_date ASC, crt.trainer_name ASC`,
      params
    );

    let rows = result.rows.map(mapRow);

    // Filter only reminder-eligible (have phone)
    if (send_reminder === 'true') {
      rows = rows.filter(r => r.send_reminder);
    }

    return res.status(200).json(rows);
  } catch (error) {
    console.error('external/trainer-reminders error:', error);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}

async function handleSingleRun(courseRunId: string, res: NextApiResponse) {
  try {
    const result = await pool.query(
      `SELECT
         cr.course_run_id,
         cr.start_date,
         cr.end_date,
         cr.mode_of_learning,
         cr.class_status,
         cr.digital_attendance_id,
         cr.venue_block,
         cr.venue_street,
         cr.venue_building,
         cr.venue_floor,
         cr.venue_unit,
         cr.venue_postal_code,
         cr.venue_room,
         c.course_code,
         c.title AS course_title,
         crt.trainer_id,
         crt.trainer_name,
         crt.trainer_email,
         tp.tel AS trainer_tel
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       JOIN course_run_trainer crt ON crt.course_run_id = cr.id
       LEFT JOIN trainer_profile tp ON tp.user_id = crt.trainer_id
       WHERE cr.course_run_id = $1
         AND crt.trainer_name IS NOT NULL`,
      [courseRunId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: `Course run ${courseRunId} not found or no trainer assigned` } });
    }

    // Return first trainer's data (single object as per spec)
    return res.status(200).json(mapRow(result.rows[0]));
  } catch (error) {
    console.error('external/trainer-reminders single error:', error);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
