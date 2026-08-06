/**
 * Deterministic trainer resolution for a course run + date, used by the trainer-reminders
 * external API. Admin staff sometimes swap a run's trainer by editing the Google Calendar
 * invite directly (and/or TPGateway) without updating course_run_trainer in the LMS — this
 * makes the LMS's own trainer assignment unreliable as a PRIMARY source of truth for "who is
 * actually teaching this specific occurrence." It is still used as a secondary disambiguation
 * signal when GCal alone is ambiguous (see step 2) — that's a materially weaker claim than
 * trusting it outright, and only kicks in when GCal already narrowed it to a short list.
 *
 * Resolution order:
 *   1. Live GCal attendees for the run's event on this date, cross-referenced against
 *      user_role_map for Trainer role.
 *        Exactly one match -> resolved (gcal_role_match).
 *   2. Two+ matches (collision) -> if the LMS's own assigned trainer (course_run_trainer) is
 *      exactly one of the candidates, that breaks the tie (lms_tiebreak).
 *   3. Anything still unresolved at this point — zero GCal matches, OR a collision the LMS
 *      assignment didn't resolve — falls back to course_run.tpg_assigned_trainer_email
 *      (tpg_fallback), used directly regardless of whether it matches a GCal candidate.
 *   4. Still nothing -> not_found (zero GCal matches, no TPG trainer) or ambiguous (a GCal
 *      collision neither LMS nor TPG could resolve, candidates listed).
 *
 * `not_found` and `ambiguous` are the only two outcomes where nothing could be confidently
 * decided — the caller surfaces an admin_warning for these so staff can check the class
 * manually instead of a reminder silently going to nobody or the wrong person.
 */
import pool from '../db';
import { getCalendarReadClient } from './calendarClient';

export type TrainerResolutionSource = 'gcal_role_match' | 'lms_tiebreak' | 'tpg_fallback' | 'ambiguous' | 'not_found';

export interface ResolvedTrainer {
  user_id: string | null;
  name: string | null;
  email: string;
}

export interface TrainerResolutionResult {
  source: TrainerResolutionSource;
  trainer: ResolvedTrainer | null;
  candidates?: ResolvedTrainer[];
  /** Set only for 'ambiguous' and 'not_found' — nothing could be confidently decided. */
  adminWarning?: string;
}

/**
 * Trainer-role app_user accounts matching any of the given emails (primary/secondary/additional).
 * Deduped by user_id — a trainer whose primary AND secondary email were both added as calendar
 * attendees (e.g. jyoti20.chopra@gmail.com + jyoti@tertiaryinfotech.com, the same person) must
 * resolve as ONE candidate, not two. Without this, a single real Trainer-role attendee could be
 * miscounted as a collision and misclassified 'ambiguous' purely because they have 2 emails on
 * the invite, even though there's no actual ambiguity about who they are.
 */
export async function matchTrainerAccounts(emails: string[]): Promise<ResolvedTrainer[]> {
  if (emails.length === 0) return [];
  const rows = (await pool.query<{ user_id: string; name: string | null; email: string }>(
    `SELECT DISTINCT au.id AS user_id, au.full_name AS name, cand.em AS email
       FROM app_user au
       JOIN LATERAL (
              SELECT au.email AS em
              UNION SELECT au.secondary_email
              UNION SELECT unnest(au.additional_emails)
            ) cand ON cand.em IS NOT NULL
       JOIN user_role_map urm ON urm.user_id = au.id AND urm.role = 'Trainer'
      WHERE lower(btrim(cand.em)) = ANY($1::text[])`,
    [emails]
  )).rows;
  const byUserId = new Map<string, ResolvedTrainer>();
  for (const r of rows) {
    if (!byUserId.has(r.user_id)) byUserId.set(r.user_id, { user_id: r.user_id, name: r.name, email: r.email });
  }
  return Array.from(byUserId.values());
}

/** Any app_user matching an email (no role requirement) — used to resolve an external trainer's LMS account, if any. */
async function findAccountByEmail(email: string): Promise<{ user_id: string; name: string | null } | null> {
  const row = (await pool.query<{ user_id: string; name: string | null }>(
    `SELECT au.id AS user_id, au.full_name AS name
       FROM app_user au
       JOIN LATERAL (
              SELECT au.email AS em
              UNION SELECT au.secondary_email
              UNION SELECT unnest(au.additional_emails)
            ) cand ON cand.em IS NOT NULL
      WHERE lower(btrim(cand.em)) = lower(btrim($1)) LIMIT 1`,
    [email]
  )).rows[0];
  return row ?? null;
}

function candidateNames(candidates: ResolvedTrainer[]): string {
  return candidates.map((c) => c.name || c.email).join(', ');
}

export async function resolveTrainerForRunDate(courseRunUuid: string, dateIso: string): Promise<TrainerResolutionResult> {
  // 1. Live GCal attendees for this specific date's event, via the durable mapping — no
  //    fuzzy title/date matching needed since course_run_calendar_event already tells us
  //    exactly which event this is.
  const attendeeEmails: string[] = [];
  const evRow = (await pool.query<{ google_event_id: string }>(
    `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1 AND event_date = $2::date`,
    [courseRunUuid, dateIso]
  )).rows[0];

  if (evRow?.google_event_id) {
    const client = await getCalendarReadClient();
    if (client) {
      try {
        const ev = await client.calendar.events.get({ calendarId: client.calendarId, eventId: evRow.google_event_id }).then((r) => r.data);
        if (ev && ev.status !== 'cancelled') {
          for (const a of ev.attendees || []) {
            if (a.resource || !a.email) continue;
            attendeeEmails.push(a.email.toLowerCase());
          }
        }
      } catch {
        // best-effort — a calendar read failure just means we fall through to LMS/TPG/not_found
      }
    }
  }

  const candidates = await matchTrainerAccounts(attendeeEmails);

  if (candidates.length === 1) {
    return { source: 'gcal_role_match', trainer: candidates[0] };
  }

  // LMS's own assigned trainer + TPG's official trainer — consulted only now, as
  // disambiguation/fallback signals, never as the primary source.
  const [lmsRow, tpgRow] = await Promise.all([
    pool.query<{ email: string | null }>(
      `SELECT nullif(lower(btrim(trainer_email)), '') AS email
         FROM course_run_trainer WHERE course_run_id = $1 LIMIT 1`,
      [courseRunUuid]
    ),
    pool.query<{ email: string | null; name: string | null }>(
      `SELECT nullif(lower(btrim(tpg_assigned_trainer_email)), '') AS email, tpg_assigned_trainer_name AS name
         FROM course_run WHERE id = $1`,
      [courseRunUuid]
    ),
  ]);
  const lmsEmail = lmsRow.rows[0]?.email ?? null;
  const tpgRowData = tpgRow.rows[0];
  const tpgEmail = tpgRowData?.email ?? null;

  if (candidates.length >= 2) {
    if (lmsEmail) {
      const tie = candidates.filter((c) => c.email.toLowerCase() === lmsEmail);
      if (tie.length === 1) return { source: 'lms_tiebreak', trainer: tie[0] };
    }
  }

  // Fell through: zero GCal candidates, or an unresolved collision — TPG is the final resort.
  if (tpgEmail) {
    const account = await findAccountByEmail(tpgEmail);
    return {
      source: 'tpg_fallback',
      trainer: { user_id: account?.user_id ?? null, name: account?.name ?? tpgRowData?.name ?? null, email: tpgEmail },
    };
  }

  if (candidates.length === 0) {
    return {
      source: 'not_found',
      trainer: null,
      adminWarning: 'No trainer could be determined for this class from the calendar, LMS assignment, or TPGateway. Please assign a trainer.',
    };
  }

  return {
    source: 'ambiguous',
    trainer: null,
    candidates,
    adminWarning: `Multiple Trainer-role attendees found on the calendar for this class (${candidateNames(candidates)}), and neither the assigned LMS trainer nor TPGateway could resolve which one is correct. Please verify and assign the correct trainer manually.`,
  };
}
