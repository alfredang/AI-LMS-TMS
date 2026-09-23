import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { getCalendarReadClient } from './calendarClient';
import { eventDateIso } from './eventMatch';
import { resolveEventTrainers, type TrainerIdentity, type TrainerResolutionResult } from './trainerIdentityRules';
export type { TrainerResolutionResult } from './trainerIdentityRules';

export async function loadTrainerDirectory(): Promise<TrainerIdentity[]> {
  const rows = (await pool.query(`
    SELECT au.id AS user_id, au.full_name AS name, au.email, tp.tel AS phone,
           ARRAY(SELECT DISTINCT lower(btrim(em)) FROM unnest(
             ARRAY[au.email, au.secondary_email] || COALESCE(au.additional_emails, ARRAY[]::text[])
           ) em WHERE em IS NOT NULL AND btrim(em) <> '') AS emails,
           (COALESCE(lower(au.account_status), 'active') = 'active'
            AND COALESCE(lower(tp.status::text), 'active') = 'active') AS active
      FROM app_user au LEFT JOIN trainer_profile tp ON tp.user_id = au.id
     WHERE EXISTS (SELECT 1 FROM user_role_map urm WHERE urm.user_id = au.id AND urm.role = 'Trainer')
  `)).rows;
  return rows.map(r => ({ ...r, email: r.email || '', emails: r.emails || [] }));
}

/** Exact mapped occurrence only; failure/ambiguity never becomes an LMS or TPG fallback. */
export async function resolveTrainerForRunDate(runUuid: string, dateIso: string, event?: calendar_v3.Schema$Event): Promise<TrainerResolutionResult> {
  try {
    if (!event) {
      const mappings = (await pool.query<{ google_event_id: string }>(
        'SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1 AND event_date = $2::date', [runUuid, dateIso],
      )).rows;
      const ids = [...new Set(mappings.map(m => m.google_event_id))];
      if (ids.length !== 1) return { source: 'ambiguous', trainer: null, pending: [], candidates: [], adminWarning: 'A unique Calendar occurrence is required.' };
      const client = await getCalendarReadClient();
      if (!client) throw new Error('Calendar unavailable');
      event = (await client.calendar.events.get({ calendarId: client.calendarId, eventId: ids[0] })).data;
    }
    if (eventDateIso(event) !== dateIso) throw new Error('Calendar occurrence date differs');
    return resolveEventTrainers(event, await loadTrainerDirectory());
  } catch {
    return { source: 'calendar_unavailable', trainer: null, pending: [], candidates: [], adminWarning: 'Cannot verify the exact Calendar guest list.' };
  }
}
