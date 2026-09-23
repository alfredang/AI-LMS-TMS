import pool from './db';
import { normalizeSgPhone, isIsoDate } from './calendar/reminderEligibilityRules';
export { normalizeSgPhone } from './calendar/reminderEligibilityRules';

/**
 * WhatsApp nudges for trainer invitations/reminders — queue side.
 *
 * The LMS never talks to WhatsApp directly. Per the architecture invariant
 * (only the LMS touches the DB; every other system integrates over the HTTPS
 * API), the email senders QUEUE a notification row here, and the OpenClaw
 * agent (Tael) polls /api/external/whatsapp-notifications with its x-api-key,
 * delivers each message from the WhatsApp Business number +65 8866 6375, and
 * POSTs the outcome back. Rows therefore go:
 *
 *   pending → sent | failed        (reported by the agent)
 *   no_phone                       (trainer has no usable number on file)
 *
 * Queued fire-and-forget from the invitation sender and the Thursday
 * reminder — a failure here never blocks the email path.
 */

export type TrainerWhatsAppKind = 'invitation' | 'reminder';

export async function ensureTrainerWhatsappTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainer_whatsapp_notification (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      course_run_id UUID REFERENCES course_run(id) ON DELETE CASCADE,
      trainer_name TEXT NOT NULL,
      trainer_email TEXT,
      trainer_phone TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_trainer_whatsapp_status
     ON trainer_whatsapp_notification(status, created_at)`
  );
  // Stamped when a row is RELEASED to the agent (dispatch mode). The
  // Facebook-safety rate limits (max 5/day, 15 min apart) are computed from
  // this timestamp so every release counts, whatever its final outcome.
  await pool.query(
    `ALTER TABLE trainer_whatsapp_notification ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ`
  );
  await pool.query(`ALTER TABLE trainer_whatsapp_notification
    ADD COLUMN IF NOT EXISTS session_date DATE,
    ADD COLUMN IF NOT EXISTS calendar_event_id TEXT,
    ADD COLUMN IF NOT EXISTS trainer_user_id UUID`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_class_reminder_session_trainer
    ON trainer_whatsapp_notification(course_run_id, session_date, trainer_user_id)
    WHERE kind='class_reminder' AND session_date IS NOT NULL AND trainer_user_id IS NOT NULL`);
}

/**
 * HARD anti-ban limits for the WhatsApp Business number (+65 8866 6375).
 * Facebook can ban numbers that blast messages, so the dispatch endpoint
 * enforces per-CHANNEL daily caps + sending windows, and a GLOBAL minimum
 * gap between any two releases (both channels share the same number).
 * Server-side, independent of how often the agent polls.
 *
 *   invitation      — trainer invitation/reminder nudges: ≤5/day, 10:00–13:00 SGT
 *   class_reminder  — upcoming-class reminders (3 days ahead): ≤7/day, 13:00–17:00 SGT
 *
 * The windows deliberately do NOT overlap (invitation nudges finish by 1pm,
 * class reminders start at 1pm) so the two streams never interleave on the
 * Business number.
 */
export interface WhatsappChannelConfig {
  kinds: string[];
  maxPerDay: number;
  windowStartHourSgt: number;
  windowEndHourSgt: number;
}
export const WHATSAPP_CHANNELS: Record<string, WhatsappChannelConfig> = {
  invitation: { kinds: ['invitation', 'reminder'], maxPerDay: 5, windowStartHourSgt: 10, windowEndHourSgt: 13 },
  class_reminder: { kinds: ['class_reminder'], maxPerDay: 7, windowStartHourSgt: 13, windowEndHourSgt: 17 },
};
export const WHATSAPP_MIN_GAP_MINUTES = 15; // global, across ALL channels
/** Pending rows older than this are expired unsent — a stale nudge is worse than none. */
export const WHATSAPP_PENDING_TTL_HOURS = 72;

/**
 * Sending-window check for a channel. Returns null when inside the window,
 * else the number of seconds until the window next opens (today or tomorrow).
 */
export function secondsUntilWhatsappWindow(
  startHour: number,
  endHour: number,
  now: Date = new Date()
): number | null {
  // Derive SGT wall-clock from UTC (SGT = UTC+8, no DST).
  const sgtMs = now.getTime() + 8 * 60 * 60 * 1000;
  const sgt = new Date(sgtMs);
  const hour = sgt.getUTCHours();
  if (hour >= startHour && hour < endHour) return null;
  const next = new Date(sgtMs);
  next.setUTCHours(startHour, 0, 0, 0);
  if (hour >= endHour) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next.getTime() - sgtMs) / 1000));
}

const fmtDate = (v: any): string => {
  if (!v) return 'N/A';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB');
};

/** Queue an already-verified Calendar session recipient. Exact run/date/person deduplication
 * includes historical attempts; failed/expired/legacy records need review before retrying.
 * The partial unique index prevents concurrent schedulers from creating duplicate reminders.
 */
export async function queueClassReminderWhatsApp(opts: {
  courseRunUuid: string;
  sessionDate: string;
  calendarEventId: string;
  trainerUserId: string;
  trainerEmails: string[];
  trainerName: string;
  trainerEmail: string | null;
  trainerPhone: string | null; // already E.164-normalized, or null
  message: string;
}): Promise<'queued' | 'skipped_duplicate' | 'error'> {
  const { courseRunUuid, trainerName, trainerEmail, trainerPhone, message } = opts;
  try {
    if (!isIsoDate(opts.sessionDate) || !opts.calendarEventId || !opts.trainerUserId || !normalizeSgPhone(trainerPhone)) return 'error';
    await ensureTrainerWhatsappTable();
    const dup = await pool.query(
      `SELECT 1 FROM trainer_whatsapp_notification n JOIN course_run cr ON cr.id=n.course_run_id
        WHERE n.course_run_id = $1
          AND n.kind = 'class_reminder'
          AND COALESCE(n.session_date,cr.start_date::date) = $2::date
          AND (n.trainer_user_id=$3 OR LOWER(n.trainer_email)=ANY($4::text[]))
        LIMIT 1`,
      [courseRunUuid, opts.sessionDate, opts.trainerUserId, opts.trainerEmails.map(e => e.toLowerCase())]
    );
    if (dup.rows.length > 0) return 'skipped_duplicate';

    const inserted = await pool.query(
      `INSERT INTO trainer_whatsapp_notification
         (course_run_id, trainer_name, trainer_email, trainer_phone, kind, message, status, session_date, calendar_event_id, trainer_user_id)
       VALUES ($1, $2, $3, $4, 'class_reminder', $5, 'pending', $6::date, $7, $8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        courseRunUuid,
        trainerName,
        trainerEmail,
        trainerPhone,
        message,
        opts.sessionDate,
        opts.calendarEventId,
        opts.trainerUserId,
      ]
    );
    return inserted.rows.length ? 'queued' : 'skipped_duplicate';
  } catch (err) {
    console.error('❌ [trainerWhatsapp] class-reminder queue failed:', err);
    return 'error';
  }
}

export async function queueTrainerWhatsAppNotification(opts: {
  courseRunUuid: string;
  trainerName: string;
  trainerEmail: string;
  kind: TrainerWhatsAppKind;
}): Promise<void> {
  const { courseRunUuid, trainerName, trainerEmail, kind } = opts;
  try {
    await ensureTrainerWhatsappTable();

    const runRes = await pool.query(
      `SELECT cr.course_run_id, cr.start_date, cr.end_date, c.title, c.course_code
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id = $1 LIMIT 1`,
      [courseRunUuid]
    );
    const run = runRes.rows[0];
    if (!run) return;

    const phoneRes = await pool.query(
      `SELECT tp.tel FROM app_user au
       JOIN trainer_profile tp ON tp.user_id = au.id
       WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1)
       ORDER BY au.created_at ASC LIMIT 1`,
      [trainerEmail]
    );
    const phone = normalizeSgPhone(phoneRes.rows[0]?.tel);

    const classLine =
      `${run.title} (Run ${run.course_run_id})\n` +
      `${fmtDate(run.start_date)} - ${fmtDate(run.end_date)}`;
    const message =
      kind === 'invitation'
        ? `Hi ${trainerName}, Tertiary Infotech Academy has just emailed you a trainer invitation for:\n\n${classLine}\n\nPlease check your email (${trainerEmail}) and click Accept or Decline. Thank you!`
        : `Hi ${trainerName}, gentle reminder from Tertiary Infotech Academy — we are still awaiting your response to the trainer invitation for:\n\n${classLine}\n\nPlease check your email (${trainerEmail}) and click Accept or Decline. Thank you!`;

    await pool.query(
      `INSERT INTO trainer_whatsapp_notification
         (course_run_id, trainer_name, trainer_email, trainer_phone, kind, message, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        courseRunUuid,
        trainerName,
        trainerEmail,
        phone,
        kind,
        message,
        phone ? 'pending' : 'no_phone',
        phone ? null : 'No usable phone number on trainer profile',
      ]
    );
    console.log(
      `📱 [trainerWhatsapp] queued ${kind} for ${trainerName} (${phone || 'NO PHONE'}) run=${run.course_run_id}`
    );
  } catch (err) {
    // Never let the WhatsApp queue break the email path.
    console.error('❌ [trainerWhatsapp] queue failed:', err);
  }
}
