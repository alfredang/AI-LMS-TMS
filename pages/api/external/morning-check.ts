import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Morning Check (TMS Class Info)
 *
 * GET /api/external/morning-check
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *   — or —
 *   Authorization: Bearer <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params:
 *   start_date        — required (YYYY-MM-DD)
 *   end_date          — required (YYYY-MM-DD)
 *   status            — optional, default "Confirmed"
 *   include_virtual   — optional, default "true"
 *   include_external  — optional, default "true"
 *   include_cancelled — optional, default "false"
 *   course_run_id     — optional, fetch a single course run
 */

function formatPhone(tel: string | null): string | null {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('65') && digits.length === 10) return `+${digits}`;
  if (digits.length === 8) return `+65${digits}`;
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
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
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
    status: row.class_status,
    mode_of_training: row.mode_of_learning || 'Physical',
    is_virtual: isVirtual,
    is_external: isExternal,
    trainer: row.trainer_name
      ? {
          trainer_id: row.trainer_id || null,
          name: row.trainer_name,
          email: row.trainer_email || null,
          phone_e164: phone,
        }
      : null,
    pax: parseInt(row.pax, 10) || 0,
    attendance_code: row.digital_attendance_id || null,
    e_attendance_url: row.digital_attendance_id
      ? `https://ai-lms-tms.tertiaryinfo.tech/e-attendance/${row.course_run_id}`
      : null,
    google_meet_url: null,
    venue: buildVenueString(row),
    calendar_event_id: null,
    calendar_event_url: null,
    assessment_folder_url: null,
    remarks: null,
    updated_at: row.updated_at,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'Method not allowed' });
  }

  // Auth: x-api-key or Bearer
  const apiKey =
    req.headers['x-api-key'] ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ error: 'internal_error', message: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });

  const {
    course_run_id,
    start_date,
    end_date,
    status,
    include_virtual,
    include_external,
    include_cancelled,
  } = req.query;

  // Single course run lookup
  if (course_run_id) {
    return handleSingle(String(course_run_id), res);
  }

  if (!start_date || !end_date) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'start_date and end_date are required in YYYY-MM-DD format',
    });
  }

  try {
    const conditions: string[] = [
      `cr.start_date >= $1`,
      `cr.start_date <= $2`,
    ];
    const params: (string | number)[] = [String(start_date), String(end_date)];
    let idx = 3;

    // Status filter
    if (include_cancelled === 'true') {
      // Include all statuses, but still filter if explicit status given
      if (status) {
        conditions.push(`cr.class_status = $${idx++}`);
        params.push(String(status));
      }
    } else {
      const classStatus = status || 'Confirmed';
      conditions.push(`cr.class_status = $${idx++}`);
      params.push(classStatus);
    }

    if (include_virtual === 'false') {
      conditions.push(`cr.mode_of_learning IS DISTINCT FROM 'Virtual'`);
    }
    if (include_external === 'false') {
      conditions.push(`cr.mode_of_learning IS DISTINCT FROM 'External'`);
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
         cr.updated_at,
         c.course_code,
         c.title AS course_title,
         crt.trainer_id,
         crt.trainer_name,
         crt.trainer_email,
         tp.tel AS trainer_tel,
         (SELECT COUNT(*)::int FROM enrollment e
          WHERE e.course_run_id = cr.id
            AND e.enrolment_status IS DISTINCT FROM 'Admin Removed'
            AND e.enrolment_status IS DISTINCT FROM 'Cancelled'
            AND e.enrolment_status IS DISTINCT FROM 'Withdrawn') AS pax
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN course_run_trainer crt ON crt.course_run_id = cr.id
       LEFT JOIN trainer_profile tp ON tp.user_id = crt.trainer_id
       ${where}
       ORDER BY cr.start_date ASC, c.course_code ASC`,
      params
    );

    // Deduplicate: one record per course_run_id (first/primary trainer)
    const seen = new Map<string, any>();
    for (const row of result.rows) {
      if (!seen.has(row.course_run_id)) {
        seen.set(row.course_run_id, mapRow(row));
      }
    }

    return res.status(200).json({ data: Array.from(seen.values()) });
  } catch (error) {
    console.error('external/morning-check error:', error);
    return res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
}

async function handleSingle(courseRunId: string, res: NextApiResponse) {
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
         cr.updated_at,
         c.course_code,
         c.title AS course_title,
         crt.trainer_id,
         crt.trainer_name,
         crt.trainer_email,
         tp.tel AS trainer_tel,
         (SELECT COUNT(*)::int FROM enrollment e
          WHERE e.course_run_id = cr.id
            AND e.enrolment_status IS DISTINCT FROM 'Admin Removed'
            AND e.enrolment_status IS DISTINCT FROM 'Cancelled'
            AND e.enrolment_status IS DISTINCT FROM 'Withdrawn') AS pax
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN course_run_trainer crt ON crt.course_run_id = cr.id
       LEFT JOIN trainer_profile tp ON tp.user_id = crt.trainer_id
       WHERE cr.course_run_id = $1`,
      [courseRunId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: `Course run ${courseRunId} not found` });
    }

    return res.status(200).json({ data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('external/morning-check single error:', error);
    return res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
}
