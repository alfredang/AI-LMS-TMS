import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { resolveClassDurationDays } from '../../../lib/trainerInvitations';
import { normalizeSgPhone, queueClassReminderWhatsApp } from '../../../lib/trainerWhatsapp';

/**
 * External API — Queue Class-Reminder WhatsApp Messages
 *
 * Daily (default 12:30 SGT, before the 13:00–17:00 sending window): for every
 * CONFIRMED course run starting `days_in_advance` days from today (default 3)
 * that has a trainer assigned in the LMS, composes the "upcoming class"
 * reminder from the LMS's own record (title, code, run id, dates, duration,
 * mode, venue / Meet link) and queues one WhatsApp message per trainer in
 * trainer_whatsapp_notification (kind 'class_reminder').
 *
 * Delivery is pulled by the OpenClaw agent (Tael) via
 * /api/external/whatsapp-notifications?channel=class_reminder, which enforces
 * the hard limits: max 7/day, 15 min apart (global), 13:00–17:00 SGT only.
 *
 * This replaces Tael's self-assembled reminders, which had wrong/blank class
 * info. Deduped per (run, trainer) so re-runs are safe.
 *
 * POST /api/external/auto-queue-class-reminders
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const fmtLong = (iso: string | null): string => {
  if (!iso) return 'N/A';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 'N/A';
  // "Sept" → "Sep": newer ICU abbreviates September inconsistently.
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep');
};

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

async function getDaysInAdvance(): Promise<number> {
  try {
    const r = await pool.query<{ days_in_advance: number | null }>(
      `SELECT days_in_advance FROM scheduler_config WHERE id = 'auto_queue_class_reminder_whatsapp' LIMIT 1`
    );
    const n = r.rows[0]?.days_in_advance;
    if (typeof n === 'number' && n >= 0) return n;
  } catch { /* first boot */ }
  return 3;
}

interface QueueSummary {
  runId: string;
  startedAt: string;
  daysInAdvance: number;
  targetDate: string;
  classes: number;
  queued: number;
  skippedDuplicates: number;
  noPhone: number;
  errors: number;
  details: Array<{ courseRunId: string; trainer: string; result: string }>;
}

export async function runAutomation(): Promise<QueueSummary> {
  const runId = `class_reminder_wa_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const daysInAdvance = await getDaysInAdvance();

  const rows = await pool.query(
    `SELECT
        cr.id AS course_run_uuid,
        cr.course_run_id,
        cr.start_date::date::text AS start_date,
        cr.end_date::date::text AS end_date,
        cr.class_type,
        cr.mode_of_learning::text AS mode_of_learning,
        cr.virtual_meeting_link,
        cr.venue_block, cr.venue_street, cr.venue_building, cr.venue_floor,
        cr.venue_unit, cr.venue_postal_code, cr.venue_room,
        c.title AS course_title,
        c.course_code,
        c.training_hours, c.assessment_hours, c.num_of_days,
        (SELECT COUNT(DISTINCT cs.start_date)::int
           FROM course_session cs
          WHERE cs.course_run_id = cr.id
            AND COALESCE(cs.deleted, false) = false
            AND cs.start_date IS NOT NULL) AS session_days,
        (SELECT COALESCE(json_agg(json_build_object(
                  'name', t.trainer_name, 'email', t.trainer_email, 'tel', tp.tel
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
       AND cr.start_date::date = (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($1::int * INTERVAL '1 day')
       AND EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
     ORDER BY cr.start_date ASC`,
    [daysInAdvance]
  );

  const targetDate = rows.rows[0]?.start_date
    || new Date(Date.now() + daysInAdvance * 86400000).toISOString().slice(0, 10);

  let queued = 0, skippedDuplicates = 0, noPhone = 0, errors = 0;
  const details: QueueSummary['details'] = [];

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lms-tms.tertiaryinfotech.com').replace(/\/$/, '');

  for (const row of rows.rows) {
    const { label: durationDays } = resolveClassDurationDays(row);
    const hours = (Number(row.training_hours) || 0) + (Number(row.assessment_hours) || 0);
    const durationLabel = durationDays !== 'N/A' && hours > 0
      ? `${durationDays} (${hours} hours)`
      : durationDays !== 'N/A' ? durationDays : hours > 0 ? `${hours} hours` : 'N/A';
    const rawMode = String(row.class_type || row.mode_of_learning || '');
    const mode = /virtual/i.test(rawMode) ? 'Virtual' : /hybrid/i.test(rawMode) ? 'Hybrid' : 'Classroom';
    const venue = buildVenueString(row);

    // Deduped trainers by email
    const seen = new Set<string>();
    for (const t of row.trainers || []) {
      const key = String(t.email || t.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const locationLine = mode === 'Virtual'
        ? (row.virtual_meeting_link ? `Google Meet: ${row.virtual_meeting_link}\n` : '')
        : (venue ? `Venue: ${venue}\n` : '');
      const message =
        `Dear ${t.name}\n` +
        `This is a gentle reminder for your upcoming training below.\n\n` +
        `Course Title: ${row.course_title}\n` +
        `Course Code: ${row.course_code || 'N/A'}\n` +
        `Course Run ID: ${row.course_run_id || 'N/A'}\n` +
        `Start Date: ${fmtLong(row.start_date)}\n` +
        `End Date: ${fmtLong(row.end_date)}\n` +
        `Course Duration: ${durationLabel}\n` +
        `Mode of Training: ${mode}\n` +
        locationLine +
        `\nTo view E-Attendance and course-related materials, please log in below:\n` +
        `${baseUrl}\n\n` +
        `Training Admin, Tertiary Infotech Academy`;

      const result = await queueClassReminderWhatsApp({
        courseRunUuid: row.course_run_uuid,
        trainerName: t.name,
        trainerEmail: t.email || null,
        trainerPhone: normalizeSgPhone(t.tel),
        message,
      });
      if (result === 'queued') {
        if (normalizeSgPhone(t.tel)) queued++; else noPhone++;
      } else if (result === 'skipped_duplicate') skippedDuplicates++;
      else errors++;
      details.push({ courseRunId: row.course_run_id, trainer: t.name, result });
    }
  }

  const summary: QueueSummary = {
    runId, startedAt, daysInAdvance, targetDate,
    classes: rows.rows.length,
    queued, skippedDuplicates, noPhone, errors, details,
  };
  console.log(
    `📱 [auto-queue-class-reminders] ${runId} — target=${targetDate} classes=${summary.classes} queued=${queued} dup=${skippedDuplicates} noPhone=${noPhone} errors=${errors}`
  );
  return summary;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
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
    const summary = await runAutomation();
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('❌ auto-queue-class-reminders error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
