import pool from '../db';
import { getCalendarReadClient } from './calendarClient';
import type {
  CalendarTrainerResponse,
  TrainerAcknowledgement,
} from './trainerAcknowledgementRules';
import {
  matchAcknowledgedTrainerTgs,
  normalizeTgsCode,
  tgsDateKey,
} from './trainerAcknowledgementRules';

export { normalizeTgsCode, tgsDateKey } from './trainerAcknowledgementRules';

export interface TrainerAcknowledgementCandidate {
  runUuid: string;
  courseCode: string | null;
  dateIso: string;
}

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const normalizeName = (value: unknown): string => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Find TGS codes for which an accepted Calendar attendee matches the TMS
 * trainer directory. A match on any run acknowledges the whole TGS/date.
 * Pending, tentative and declined responses are not acknowledgements.
 *
 * STRICT: throws if Calendar is unavailable or any event read fails. Callers
 * that must keep going for the runs that could be checked should use
 * findAcknowledgedTrainerTgsTolerant instead.
 */
export async function findAcknowledgedTrainerTgs(
  candidates: TrainerAcknowledgementCandidate[],
): Promise<Map<string, TrainerAcknowledgement>> {
  const result = await findAcknowledgedTrainerTgsTolerant(candidates);
  if (result.calendarUnavailable) {
    throw new Error('Cannot evaluate trainer acknowledgement because Google Calendar is unavailable');
  }
  if (result.failedReads > 0) {
    throw new Error(`Cannot evaluate trainer acknowledgement: ${result.failedReads} Calendar event read(s) failed`);
  }
  return result.acknowledged;
}

export interface TolerantAcknowledgementResult {
  acknowledged: Map<string, TrainerAcknowledgement>;
  /** Runs whose acknowledgement could NOT be determined (Calendar down or an event read failed). */
  uncheckedRunUuids: Set<string>;
  calendarUnavailable: boolean;
  failedReads: number;
}

/**
 * Same as findAcknowledgedTrainerTgs, but never throws: one unreadable event
 * (or Calendar being down) only marks the affected runs as unchecked instead
 * of failing every run. Callers decide what "unchecked" means for them.
 */
export async function findAcknowledgedTrainerTgsTolerant(
  candidates: TrainerAcknowledgementCandidate[],
): Promise<TolerantAcknowledgementResult> {
  const usable = candidates
    .map((candidate) => ({
      ...candidate,
      courseCode: normalizeTgsCode(candidate.courseCode),
      dateIso: String(candidate.dateIso || '').slice(0, 10),
    }))
    .filter((candidate) => candidate.runUuid && candidate.courseCode && candidate.dateIso);
  const empty = (): TolerantAcknowledgementResult => ({
    acknowledged: new Map(), uncheckedRunUuids: new Set(), calendarUnavailable: false, failedReads: 0,
  });
  if (usable.length === 0) return empty();

  const allRunUuids = new Set(usable.map((candidate) => candidate.runUuid));
  let client: Awaited<ReturnType<typeof getCalendarReadClient>> = null;
  try {
    client = await getCalendarReadClient();
  } catch (err) {
    console.error('⚠️ [trainerAcknowledgement] Calendar client failed:', err);
  }
  if (!client) {
    return { ...empty(), uncheckedRunUuids: allRunUuids, calendarUnavailable: true };
  }

  const runUuids = [...new Set(usable.map((candidate) => candidate.runUuid))];
  const mappings = (await pool.query<{
    course_run_id: string;
    event_date: string;
    google_event_id: string;
  }>(
    `SELECT course_run_id, event_date::date::text AS event_date, google_event_id
       FROM course_run_calendar_event
      WHERE course_run_id = ANY($1::uuid[])`,
    [runUuids],
  )).rows;

  const candidateByRunDate = new Map<string, string[]>();
  for (const candidate of usable) {
    const key = `${candidate.runUuid}|${candidate.dateIso}`;
    const codes = candidateByRunDate.get(key) || [];
    if (!codes.includes(candidate.courseCode)) codes.push(candidate.courseCode);
    candidateByRunDate.set(key, codes);
  }

  const eventRows = mappings.filter((mapping) =>
    candidateByRunDate.has(`${mapping.course_run_id}|${String(mapping.event_date).slice(0, 10)}`),
  );
  const eventResults = await Promise.allSettled(
    eventRows.map(async (mapping) => ({
      mapping,
      event: await client.calendar.events.get({
        calendarId: client.calendarId,
        eventId: mapping.google_event_id,
      }).then((response) => response.data),
    })),
  );
  const uncheckedRunUuids = new Set<string>();
  let failedReads = 0;
  eventResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      failedReads++;
      uncheckedRunUuids.add(eventRows[index].course_run_id);
      console.error(
        `⚠️ [trainerAcknowledgement] Calendar event read failed for run=${eventRows[index].course_run_id} ` +
        `event=${eventRows[index].google_event_id}:`, result.reason
      );
    }
  });

  const acceptedResponses: CalendarTrainerResponse[] = [];
  for (const result of eventResults) {
    if (result.status !== 'fulfilled') continue;
    const { mapping, event } = result.value;
    if (!event || event.status === 'cancelled') continue;
    const codes = candidateByRunDate.get(`${mapping.course_run_id}|${String(mapping.event_date).slice(0, 10)}`) || [];
    for (const attendee of event.attendees || []) {
      if (attendee.resource || attendee.responseStatus !== 'accepted') continue;
      for (const code of codes) {
        const dateIso = String(mapping.event_date).slice(0, 10);
        acceptedResponses.push({
          courseCode: code,
          dateIso,
          email: attendee.email || null,
          name: attendee.displayName || null,
          responseStatus: attendee.responseStatus || null,
        });
      }
    }
  }
  if (acceptedResponses.length === 0) {
    return { acknowledged: new Map(), uncheckedRunUuids, calendarUnavailable: false, failedReads };
  }

  const allEmails = [...new Set(acceptedResponses.map((response) => normalizeEmail(response.email)).filter(Boolean))];
  const allNames = [...new Set(acceptedResponses.map((response) => normalizeName(response.name)).filter(Boolean))];
  const directoryRows = (await pool.query<{ email: string | null; name: string | null }>(
    `SELECT DISTINCT lower(btrim(cand.em)) AS email,
            lower(regexp_replace(btrim(au.full_name), '\\s+', ' ', 'g')) AS name
       FROM app_user au
       JOIN LATERAL (
              SELECT au.email AS em
              UNION SELECT au.secondary_email
              UNION SELECT unnest(au.additional_emails)
            ) cand ON cand.em IS NOT NULL
       JOIN user_role_map urm ON urm.user_id = au.id AND urm.role = 'Trainer'
      WHERE lower(btrim(cand.em)) = ANY($1::text[])
         OR lower(regexp_replace(btrim(au.full_name), '\\s+', ' ', 'g')) = ANY($2::text[])
      UNION
     SELECT DISTINCT lower(btrim(trainer_email)) AS email,
            lower(regexp_replace(btrim(trainer_name), '\\s+', ' ', 'g')) AS name
       FROM course_run_trainer
      WHERE lower(btrim(trainer_email)) = ANY($1::text[])
         OR lower(regexp_replace(btrim(trainer_name), '\\s+', ' ', 'g')) = ANY($2::text[])`,
    [allEmails, allNames],
  )).rows;

  return {
    acknowledged: matchAcknowledgedTrainerTgs(acceptedResponses, directoryRows),
    uncheckedRunUuids,
    calendarUnavailable: false,
    failedReads,
  };
}
