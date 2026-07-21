import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { resolveTrainerForRunDate, TrainerResolutionResult } from '../../../lib/calendar/resolveTrainerFromCalendar';

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
 *
 * TRAINER RESOLUTION: the trainer is NOT read directly from course_run_trainer (LMS admin
 * staff sometimes swap a run's trainer by editing the Google Calendar invite and/or
 * TPGateway directly, without updating the LMS — the LMS assignment is not trustworthy as a
 * PRIMARY source). Instead, every run's live Google Calendar attendees are cross-checked
 * against user_role_map for the Trainer role first; the LMS assignment and TPGateway are only
 * consulted afterward, as disambiguation/fallback signals.
 * See lib/calendar/resolveTrainerFromCalendar.ts and the response's `trainer_resolution`
 * field, which reports how the trainer was determined:
 *   gcal_role_match — exactly one Trainer-role GCal attendee (most reliable)
 *   lms_tiebreak    — multiple Trainer-role GCal attendees; the LMS's own assigned trainer
 *                     (course_run_trainer) was uniquely among them, breaking the tie
 *   tpg_fallback    — nothing else resolved it (zero GCal matches, or an LMS-unresolved
 *                     collision); used TPGateway's official trainer directly
 *   ambiguous       — multiple Trainer-role GCal attendees, nothing resolved it — see `candidates`
 *   not_found       — no GCal match, no LMS/TPG trainer either
 * `ambiguous` and `not_found` also set `admin_warning` (string) — nothing could be confidently
 * decided, so surface it to staff rather than sending a reminder based on a guess. Runs with
 * these outcomes still appear in the response (trainer: null) rather than being silently
 * dropped.
 */

function formatPhone(tel: string | null): string | null {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, '');
  if (!digits) return null;
  let formatted: string;
  if (digits.startsWith('65') && digits.length === 10) formatted = `+${digits}`;
  else if (digits.length === 8) formatted = `+65${digits}`;
  else if (tel.startsWith('+')) formatted = tel;
  else formatted = `+${digits}`;
  // Plausibility check — a real E.164 number is 8-15 digits after the '+'. Without this,
  // a corrupted/truncated DB value (e.g. "+9276") sails through unformatted and unvalidated,
  // producing a reminder blast to a garbage number instead of being caught and skipped.
  const formattedDigits = formatted.replace(/\D/g, '');
  if (formattedDigits.length < 8 || formattedDigits.length > 15) return null;
  return formatted;
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

function computeDurationLabel(row: any): string {
  // Prefer scheduled session days, then course.num_of_days, then calendar span.
  const toPositiveInt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const sessionDays = toPositiveInt(row?.session_days);
  if (sessionDays) return sessionDays === 1 ? '1 day' : `${sessionDays} days`;
  const numOfDays = toPositiveInt(row?.num_of_days);
  if (numOfDays) return numOfDays === 1 ? '1 day' : `${numOfDays} days`;
  if (row?.start_date && row?.end_date) {
    const start = new Date(row.start_date);
    const end = new Date(row.end_date);
    const span = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (span <= 1) return '1 day';
    return `${span} days`;
  }
  return 'N/A';
}

/** Look up trainer_profile.tel for a resolved trainer's user_id, if any. */
async function lookupTrainerPhone(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const row = (await pool.query<{ tel: string | null }>(
    `SELECT tel FROM trainer_profile WHERE user_id = $1 LIMIT 1`,
    [userId]
  )).rows[0];
  return row?.tel ?? null;
}

function mapRow(row: any, resolution: TrainerResolutionResult, phoneRaw: string | null) {
  const phone = formatPhone(phoneRaw);
  const isVirtual = row.mode_of_learning === 'Virtual';
  const isExternal = row.mode_of_learning === 'External';

  return {
    course_run_id: row.course_run_id,
    course_code: row.course_code,
    course_title: row.course_title,
    start_date: row.start_date,
    end_date: row.end_date,
    duration_label: computeDurationLabel(row),
    mode_of_training: row.mode_of_learning || 'Physical',
    trainer: resolution.trainer
      ? {
          trainer_id: resolution.trainer.user_id,
          name: resolution.trainer.name,
          phone_e164: phone,
          email: resolution.trainer.email,
        }
      : null,
    trainer_resolution: {
      source: resolution.source,
      ...(resolution.candidates ? { candidates: resolution.candidates } : {}),
    },
    // Set only when trainer_resolution.source is 'ambiguous' or 'not_found' — nothing could
    // be confidently decided from GCal, the LMS assignment, or TPGateway. Staff should check
    // this class manually; a reminder should not be auto-sent based on a guess.
    admin_warning: resolution.adminWarning ?? null,
    lms_login_url: (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/',
    e_attendance_url: row.digital_attendance_id
      ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${row.digital_attendance_id}`
      : null,
    google_meet_url: row.virtual_meeting_link || null,
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

const BASE_SELECT = `
  SELECT
     cr.id AS run_uuid,
     cr.course_run_id,
     cr.start_date::text AS start_date,
     cr.end_date::text AS end_date,
     cr.mode_of_learning,
     cr.class_status,
     cr.digital_attendance_id,
     cr.virtual_meeting_link,
     cr.venue_block,
     cr.venue_street,
     cr.venue_building,
     cr.venue_floor,
     cr.venue_unit,
     cr.venue_postal_code,
     cr.venue_room,
     c.course_code,
     c.title AS course_title,
     c.num_of_days,
     (
       SELECT COUNT(DISTINCT cs.start_date)::int
       FROM course_session cs
       WHERE cs.course_run_id = cr.id
         AND COALESCE(cs.deleted, false) = false
         AND cs.start_date IS NOT NULL
     ) AS session_days,
     (
       -- cs.start_date is text in SSG's native YYYYMMDD format — cast through ::date so the
       -- aggregated array comes back as proper ISO YYYY-MM-DD strings, matching the
       -- start_date/end_date query params these get compared against in JS.
       SELECT array_agg(DISTINCT (cs.start_date::date)::text ORDER BY (cs.start_date::date)::text)
       FROM course_session cs
       WHERE cs.course_run_id = cr.id
         AND COALESCE(cs.deleted, false) = false
         AND cs.start_date IS NOT NULL
     ) AS session_dates
   FROM course_run cr
   JOIN course c ON c.id = cr.course_id
`;

/**
 * Resolve trainer + phone for every row, in parallel. Row order is preserved.
 *
 * `window` (batch endpoint only) picks, per run, the specific session date that actually
 * fell inside the queried range — NOT just the run's overall start_date. A multi-day run's
 * trainer can legitimately differ day to day (that's the whole reason this resolution exists),
 * so a day-2 reminder must check day-2's calendar event, not day-1's.
 */
async function resolveAllRows(rows: any[], window?: { start: string; end: string }): Promise<ReturnType<typeof mapRow>[]> {
  return Promise.all(
    rows.map(async (row) => {
      const sessionDates: string[] = row.session_dates || [];
      const matchedDate = window
        ? sessionDates.find((d) => d >= window.start && d <= window.end) || row.start_date
        : row.start_date;
      const resolution = await resolveTrainerForRunDate(row.run_uuid, String(matchedDate).slice(0, 10));
      const phoneRaw = await lookupTrainerPhone(resolution.trainer?.user_id ?? null);
      return mapRow(row, resolution, phoneRaw);
    })
  );
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
    // Item: no longer requires a course_run_trainer row to exist — a run with no LMS trainer
    // assignment (e.g. only ever set via a calendar invite) must still appear, not vanish.
    //
    // Item: date match is against actual SESSION days, not the run's overall start/end window.
    // The old `cr.start_date >= $1 AND cr.end_date <= $2` required the run's ENTIRE span to fit
    // inside the queried range — a multi-day run starting before the window (e.g. a 2-day class
    // running 21-22 Jul, queried for just 22 Jul) was invisible even though it has a real
    // teaching day in range. Every day a run has a session is a legitimate reminder day.
    const conditions: string[] = [
      `EXISTS (
         SELECT 1 FROM course_session cs
          WHERE cs.course_run_id = cr.id
            AND COALESCE(cs.deleted, false) = false
            AND cs.start_date::date >= $1::date AND cs.start_date::date <= $2::date
       )`,
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
      `${BASE_SELECT} ${where} ORDER BY cr.start_date ASC`,
      params
    );

    let rows = await resolveAllRows(result.rows, { start: String(start_date), end: String(end_date) });

    // Filter only reminder-eligible (have phone)
    if (send_reminder === 'true') {
      rows = rows.filter((r) => r.send_reminder);
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
      `${BASE_SELECT} WHERE cr.course_run_id = $1`,
      [courseRunId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'not_found', message: `Course run ${courseRunId} not found` } });
    }

    const [mapped] = await resolveAllRows([result.rows[0]]);
    return res.status(200).json(mapped);
  } catch (error) {
    console.error('external/trainer-reminders single error:', error);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
