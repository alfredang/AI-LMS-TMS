import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { matchEventsToRuns, type CandidateRun, type EventMapping } from './eventRunRules';
export type { CandidateRun, ResolutionTier, ResolvedEventRun } from './eventRunRules';

/** GET/report matching is always read-only. Never persist an inferred event/run link. */
export async function resolveEventsToRuns(events: calendar_v3.Schema$Event[], runs: CandidateRun[], start: string, end: string, _options?: { dryRun?: boolean }) {
  const ids = events.flatMap(e => e.id ? [e.id] : []);
  const mappings = ids.length ? (await pool.query<EventMapping>(
    'SELECT google_event_id, course_run_id, event_date::date::text AS event_date FROM course_run_calendar_event WHERE google_event_id = ANY($1::text[])', [ids],
  )).rows : [];
  return matchEventsToRuns(events, runs, mappings, start, end);
}
