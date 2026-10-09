import pool from '../db';
import { ensureClassCalendarEvent, syncClassAttendees } from './ensureClassCalendarEvent';

/**
 * Create (or adopt) the Google Calendar event for upcoming classes that have
 * Confirmed learners but no event for one or more of their class days.
 *
 * Events were only created as a side effect of something happening to a class
 * (a trainer accepting, a DA learner enrolling, an admin action, "Sync all").
 * A class whose learners all arrived through the SSG fetch with no trainer yet
 * (e.g. 1450051, 42 learners) got no event, so admins made one by hand — with
 * no Course Run ID, which the LMS then couldn't link.
 *
 * Reuses ensureClassCalendarEvent, so an event that already exists for the
 * class/date (including a hand-made one) is ADOPTED and stamped with the Course
 * Run ID rather than duplicated. Then adds the confirmed learners and LMS-assigned
 * trainers. The TPG trainer is deliberately NOT added here: on classes filled in
 * by the old nightly auto-assign it is still an unconfirmed default.
 *
 * Scope: not Cancelled, starts today..+30 days (SGT), ≥1 Confirmed learner, has
 * real session dates, and EITHER is new (no event yet, first Confirmed learner in
 * the last 7 days) OR already has an LMS event but is missing one for a later
 * class day. Older classes without a linked event are left to admins (their
 * events were hand-made; an exact-date adopt miss would duplicate). Bounded by `limit`.
 * No calendar emails are sent (sendUpdates: 'none' in both helpers).
 */
export interface EnsureEnrolledRunsResult {
  candidates: number;
  created: number;
  adopted: number;
  learnersAdded: number;
  errors: number;
  runs: Array<{ courseRunId: string; created: number; adopted: number; attendeesAdded: number; status: string; reason?: string }>;
}

export async function ensureEventsForEnrolledRuns(opts: { limit?: number; daysAhead?: number } = {}): Promise<EnsureEnrolledRunsResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const daysAhead = Math.max(1, Math.min(opts.daysAhead ?? 30, 90));
  const out: EnsureEnrolledRunsResult = { candidates: 0, created: 0, adopted: 0, learnersAdded: 0, errors: 0, runs: [] };

  const candidates = (await pool.query<{ id: string; course_run_id: string }>(
    `SELECT cr.id, cr.course_run_id
       FROM course_run cr
      WHERE cr.class_status::text <> 'Cancelled'
        AND cr.start_date::date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
        AND cr.start_date::date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($2::int * INTERVAL '1 day')
        AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed')
        -- Real session dates only: never guess a class day from start_date (the
        -- 02:30 session gap-fill pulls them for classes with learners).
        AND EXISTS (SELECT 1 FROM course_session cs
                     WHERE cs.course_run_id = cr.id AND cs.deleted IS NOT TRUE AND cs.start_date IS NOT NULL)
        AND (
          -- A NEW class: no event yet and its first Confirmed learner arrived in the
          -- last 7 days. Older classes are left alone — their events were made by
          -- hand, and an exact-date adopt miss would create a duplicate.
          (NOT EXISTS (SELECT 1 FROM course_run_calendar_event ce WHERE ce.course_run_id = cr.id)
           AND (SELECT MIN(e.created_at) FROM enrollment e
                 WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed') >= NOW() - INTERVAL '7 days')
          -- Or a class the LMS already tracks, missing an event for a later class day.
          OR (EXISTS (SELECT 1 FROM course_run_calendar_event ce WHERE ce.course_run_id = cr.id)
              AND EXISTS (
                SELECT 1 FROM course_session cs
                 WHERE cs.course_run_id = cr.id AND cs.deleted IS NOT TRUE AND cs.start_date IS NOT NULL
                   AND cs.start_date::date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
                   AND NOT EXISTS (SELECT 1 FROM course_run_calendar_event ce
                                    WHERE ce.course_run_id = cr.id AND ce.event_date = cs.start_date::date)))
        )
      ORDER BY cr.start_date ASC
      LIMIT $1`,
    [limit, daysAhead]
  )).rows;
  out.candidates = candidates.length;

  for (const run of candidates) {
    try {
      const ens = await ensureClassCalendarEvent(run.id);
      let attendeesAdded = 0;
      if (ens.status === 'ok' && ens.created + ens.adopted > 0) {
        const att = await syncClassAttendees(run.id, { includeTpgTrainer: false });
        attendeesAdded = att.added;
        out.errors += att.errors;
      }
      out.created += ens.created;
      out.adopted += ens.adopted;
      out.learnersAdded += attendeesAdded;
      out.errors += ens.errors;
      out.runs.push({ courseRunId: run.course_run_id, created: ens.created, adopted: ens.adopted, attendeesAdded, status: ens.status, reason: ens.reason });
      if (ens.created + ens.adopted > 0) {
        console.log(
          `📅 [ensure-enrolled-run-events] run ${run.course_run_id}: created=${ens.created} adopted=${ens.adopted} attendees+${attendeesAdded}`
        );
      }
    } catch (err) {
      out.errors++;
      out.runs.push({ courseRunId: run.course_run_id, created: 0, adopted: 0, attendeesAdded: 0, status: 'error', reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
