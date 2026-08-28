import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getSSGCredentialsService, SSGCredentials } from '../../../../lib/ssg/services/credentials-service';
import { HTTPRequestBuilder, HttpMethod, handleRequest, HttpClient } from '../../../../lib/ssg/utils/http-utils';
import { Cryptography } from '../../../../lib/ssg/utils/cryptography';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../../lib/courseCode';

/**
 * POST /api/admin/wsq-schedule-sync/run-sync
 * Body: { items: { course_code, start_date, end_date }[], triggered_by?: 'user'|'cron' }
 *
 * Creates a wsq_sync_job row, responds immediately with { job_id }, then
 * processes all items in the background. Survives browser close / page refresh.
 *
 * Recovery: stale "running" jobs older than 15 minutes are auto-expired on the
 * next call so a crashed/redeployed sync doesn't block future syncs forever.
 * Because the comparison (wsq-schedule-sync) only flags truly unsynced runs as
 * missing, re-running after a partial failure naturally skips already-done items.
 */

type SubmitItem = { course_code: string; start_date: string; end_date: string; raw?: string };
type ItemResult = {
  course_code: string; start_date: string; end_date: string;
  status: 'submitted' | 'exists' | 'no_course' | 'no_session_timing' | 'ssg_error' | 'error';
  ssg_run_id?: string; local_run_id?: string; message?: string;
};

// ── Session helpers (mirrors submit-to-ssg.ts) ────────────────────────────────

const normalizeModeOfTraining = (raw: any): string => {
  if (!raw) return '1';
  const s = String(raw).trim();
  if (['1', '2', '4', '8', '9', '10'].includes(s)) return s;
  const l = s.toLowerCase();
  if (l.includes('assess'))                               return '8';
  if (l.includes('sync') || l.includes('synchronous'))   return '9';
  if (l.includes('async') || l.includes('asynchronous')) return '2';
  if (l.includes('classroom'))                            return '1';
  if (l.includes('job') || l.includes('ojt'))             return '4';
  if (l.includes('work'))                                 return '10';
  return '1';
};

// SSG mode-of-training codes, in words. The codes are what SSG wants; a person
// approving a run in WhatsApp should not have to know that 8 means assessment.
export const MODE_OF_TRAINING_NAMES: Record<string, string> = {
  '1': 'Classroom',
  '2': 'Asynchronous e-learning',
  '4': 'On-the-job',
  '8': 'Assessment',
  '9': 'Synchronous e-learning',
  '10': 'Practical / workplace',
};
export const modeOfTrainingName = (code: string): string =>
  MODE_OF_TRAINING_NAMES[String(code)] ?? `Mode ${code}`;

const addDays = (dateStr: string, n: number): string => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * The exact teaching dates, read from the storefront's own human-readable label.
 *
 * start/end alone cannot express a scattered run: "5/12/13/19/26 Sep 2026" spans
 * 22 days but is taught on five Saturdays and Sundays. The label spells every day
 * out, so parse it rather than interpolating between the endpoints.
 *
 * Handles the 22 label shapes the storefront actually produces, e.g.
 *   16/17 Oct 2026 (Fri/Sat)              two days, one month
 *   5/12/13/19/26 Sep 2026 (Sat/Sun)      scattered, one month
 *   30 Oct / 2 Nov 2026 (Fri/Mon)         split across months
 *   28 Dec 2026 - 1 Jan 2027 (Mon-Fri)    consecutive across years
 *   26-30 Oct 2026 (Mon-Fri)              consecutive
 *   01 Sep 2026 (Tue)                     single day
 *
 * The trailing "(Sat/Sun)" is day NAMES, not dates — dropped before parsing, or
 * a five-day run reads as seven. Months and years propagate right-to-left, since
 * "5/12/13 Sep 2026" states them only once at the end.
 *
 * Returns null when the label cannot be read confidently; the caller then falls
 * back to deriving dates from start/end.
 */
const parseRawDates = (raw: string): string[] | null => {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\([^)]*\)/g, ' ')      // "(Sat/Sun)" — day names, not dates
    .replace(/\bevening\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const isRange = !cleaned.includes('/') && cleaned.includes('-');
  const parts = cleaned.split(isRange ? '-' : '/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 12) return null;

  // Right-to-left: a bare "5" inherits the month and year stated later in the label.
  let month = 0;
  let year = 0;
  const dates: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].match(/^(\d{1,2})\s*([A-Za-z]{3,9})?\.?\s*(\d{4})?$/);
    if (!m) return null;
    const day = Number(m[1]);
    if (m[3]) year = Number(m[3]);
    if (m[2]) {
      const mm = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (!mm) return null;
      month = mm;
    }
    if (!day || !month || !year) return null;
    dates.unshift(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  if (isRange) {
    // "26-30 Oct" / "28 Dec 2026 - 1 Jan 2027" — every day between, inclusive.
    if (dates.length !== 2) return null;
    const out: string[] = [];
    for (let d = dates[0]; d <= dates[1]; d = addDays(d, 1)) {
      out.push(d);
      if (out.length > 40) return null;
    }
    return out;
  }

  // A slash list must be ascending; anything else means we misread it.
  for (let i = 1; i < dates.length; i++) if (dates[i] <= dates[i - 1]) return null;
  return dates;
};

/** Whole days from a to b, both YYYY-MM-DD. */
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/**
 * Which calendar dates the template's teaching days land on.
 *
 * A class is NOT always run on consecutive days: the storefront sells plenty of
 * "1/4 Jan 2027 Fri/Mon" style runs, where the two teaching days sit either side
 * of a weekend. Counting forward one day per teaching day put day two on the
 * Saturday — verified 26 Aug 2026 on a real submission, where TPGateway showed
 * sessions on 1 and 2 Jan with the advertised 4 Jan empty. Attendance is taken
 * per session, so those learners would have had nothing to register against on
 * the day they actually attended.
 *
 * The storefront already tells us the real teaching days: it gives the run's
 * start AND end. So anchor to those rather than counting.
 */
const teachingDates = (dayCount: number, startDate: string, endDate: string): string[] => {
  if (dayCount <= 1) return [startDate];
  const span = daysBetween(startDate, endDate) + 1;
  // Consecutive run (16-17 Jan): every day between start and end is a teaching day.
  if (span === dayCount) {
    return Array.from({ length: dayCount }, (_, i) => addDays(startDate, i));
  }
  // Split run (1 Jan / 4 Jan): first and last are the dates actually sold. Any
  // middle days are unknowable from start+end alone, so they follow the start.
  // Never invent more distinct days than the run actually spans — padding to
  // reach dayCount repeats the end date, which then reads as "enough days" while
  // silently stacking two teaching days onto one. Return what the span allows and
  // let the caller report the shortfall.
  const usableDays = Math.min(dayCount, span);
  if (usableDays === span) {
    return Array.from({ length: usableDays }, (_, i) => addDays(startDate, i));
  }
  const out = [startDate];
  for (let i = 1; i < usableDays - 1; i++) out.push(addDays(startDate, i));
  out.push(endDate);
  return out;
};

type BuiltSession = { startDate: string; endDate: string; startTime: string; endTime: string; modeOfTraining: string };
type SessionMismatch = { mismatch: { templateDays: number; runDays: number } };

type PastPattern = { day: number; startTime: string; endTime: string; modeOfTraining: string }[];

/** A run is "evening" when its first session starts at or after 17:00. */
const EVENING_FROM = '17:00';

/**
 * The session pattern this course last actually ran, as accepted by SSG.
 *
 * Preferred over course_session_timing because a course carries only ONE
 * template and is frequently sold in TWO shapes. Lean Six Sigma runs as one full
 * day (09:15-13:15, 14:00-17:00, 17:00-18:00 assessment) AND as two evenings
 * (18:00-22:00, then 18:00-21:00 + 21:00-22:00 assessment) — the template
 * describes only the first, so building an evening run from it starts the class
 * at quarter past nine in the morning.
 *
 * Matched on shape, not just recency: same number of teaching days, and evening
 * only clones from evening. Measured 27 Aug 2026 — every one of the 63 evening
 * runs on record starts at 18:00, and night one is always 18:00-22:00; only the
 * night-two split varies by course, which is exactly why it is cloned per course
 * rather than derived from a rule.
 */
async function pastSessionPattern(
  courseId: string,
  teachingDays: number,
  wantEvening: boolean,
): Promise<PastPattern | null> {
  const rows = (await pool.query<{ start_date: string; start_time: string; end_time: string; mode_of_training: string }>(
    `WITH candidate AS (
        SELECT cr.id, max(cr.start_date) AS started
          FROM course_run cr
          JOIN course_session s ON s.course_run_id = cr.id AND COALESCE(s.deleted, false) = false
         WHERE cr.course_id = $1
           AND COALESCE(cr.is_deleted, false) = false
         GROUP BY cr.id
        HAVING count(DISTINCT s.start_date) = $2
           AND (min(s.start_time) >= $3) = $4
         ORDER BY started DESC
         LIMIT 1)
      SELECT s.start_date, s.start_time, s.end_time, s.mode_of_training
        FROM candidate cnd
        JOIN course_session s ON s.course_run_id = cnd.id AND COALESCE(s.deleted, false) = false
       ORDER BY s.start_date, s.start_time`,
    [courseId, teachingDays, EVENING_FROM, wantEvening],
  ).catch(() => ({ rows: [] as any[] }))).rows;
  if (rows.length === 0) return null;

  // Collapse the past run's own dates into day indexes, so the pattern can be
  // laid onto whatever dates the new run uses.
  const dayIndex = new Map<string, number>();
  for (const r of rows) if (!dayIndex.has(r.start_date)) dayIndex.set(r.start_date, dayIndex.size);
  return rows.map((r) => ({
    day: dayIndex.get(r.start_date)!,
    startTime: (r.start_time || '').trim(),
    endTime: (r.end_time || '').trim(),
    modeOfTraining: normalizeModeOfTraining(r.mode_of_training),
  }));
}

const EVENING_START_MIN = 18 * 60;   // every one of the 63 evening runs on record starts at 18:00
const EVENING_LENGTH_MIN = 4 * 60;   // and night one is always 18:00-22:00
// Hard bound on how late a derived evening may run. Without it the final night
// absorbs whatever will not fit: a 16-hour course over two evenings derives a
// night ending at 30:00 — six in the morning. 553 templates do this. 23:00 leaves
// room for the genuine 20:45-22:15 assessment slot seen in real runs while
// refusing anything that is plainly not a class.
const EVENING_LATEST_END_MIN = 23 * 60;

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toClock = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * An evening pattern derived from the course's daytime template.
 *
 * Used only when a course is sold as an evening class but has never run one, so
 * there is nothing to clone. Rather than invent times, repack the daytime
 * template's session LENGTHS, in order, into evenings from 18:00, four hours a
 * night — which is demonstrably the rule the schedulers already follow.
 *
 * Verified 27 Aug 2026 against every evening course with history, and it
 * reproduces each exactly, including the two different night-two splits:
 *   09:15-13:15 / 14:00-17:00 / 17:00-18:00
 *     -> 18:00-22:00 | 18:00-21:00 + 21:00-22:00   (Lean Six Sigma, Interviewing)
 *   09:15-13:15 / 14:00-16:30 / 16:30-18:00
 *     -> 18:00-22:00 | 18:00-20:30 + 20:30-22:00   (Lightroom, AI for eCommerce)
 *
 * Session order, lengths and modes are preserved, so the assessment stays last
 * and keeps its own slot.
 */
const deriveEveningPattern = (
  slots: { startTime: string; endTime: string; modeOfTraining: string }[],
  nights: number,
): PastPattern => {
  const out: PastPattern = [];
  let night = 0;
  let cursor = EVENING_START_MIN;
  for (const sl of slots) {
    const length = toMinutes(sl.endTime) - toMinutes(sl.startTime);
    if (length <= 0) return [];
    if (cursor + length > EVENING_START_MIN + EVENING_LENGTH_MIN && night < nights - 1) {
      night++;
      cursor = EVENING_START_MIN;
    }
    if (cursor + length > EVENING_LATEST_END_MIN) return [];
    out.push({
      day: night,
      startTime: toClock(cursor),
      endTime: toClock(cursor + length),
      modeOfTraining: sl.modeOfTraining,
    });
    cursor += length;
  }
  return out;
};

const buildSessions = (
  timing: Record<string, any>,
  startDate: string,
  endDate: string,
  raw?: string,
  pattern?: PastPattern | null,
): BuiltSession[] | SessionMismatch => {
  type Slot = { day: number; startTime: string; endTime: string; modeOfTraining: string };

  // Pass 1 — the slots, and which teaching DAY each one falls on.
  // A cloned pattern already carries its day indexes; a template does not, so
  // there a slot starting earlier than the previous one ended marks a new day.
  let slots: Slot[];
  let day = 0;
  if (pattern && pattern.length > 0) {
    slots = pattern;
    day = Math.max(...pattern.map((p) => p.day));
  } else {
    slots = [];
    let prevEndTime = '';
    for (let i = 1; i <= 11; i++) {
      const startTime = (timing[`session_${i}_start_time`] || '').trim();
      const endTime   = (timing[`session_${i}_end_time`]   || '').trim();
      if (!startTime && !endTime) break;
      if (prevEndTime && startTime && startTime < prevEndTime) day++;
      prevEndTime = endTime;
      slots.push({
        day,
        startTime,
        endTime,
        modeOfTraining: normalizeModeOfTraining(timing[`session_${i}_mode_of_training`]),
      });
    }
  }
  if (slots.length === 0) return [];

  // Pass 2 — put those days on the dates the storefront actually sells.
  // Prefer the storefront's own label, but only when it agrees with the start and
  // end dates we were given: those come from structured fields and are the thing
  // SSG will hold the run against. A label that disagrees has been misread, and
  // guessing wrong here puts a class on a day nobody attends.
  const dayCount = day + 1;
  const parsed = parseRawDates(raw ?? '');
  const anchored = parsed
    && parsed[0] === startDate
    && parsed[parsed.length - 1] === endDate;

  // The template and the storefront must agree on how many days the class runs.
  // They disagree in both directions, and neither can be papered over:
  //
  //   template needs MORE days than the run offers — the extra days clamp onto
  //     the last date, giving two 09:15 starts and three overlapping afternoons.
  //     SSG replies "Session seqNo #5 is overlapping with seqNo #7", which is
  //     true and unactionable. Seen on TGS-2024045221 "2-4 Oct 2026 (Fri-Mon)",
  //     where Friday to Monday is four days but the dates say three.
  //
  //   run offers MORE days than the template covers — measured 27 Aug 2026, 177
  //     runs. Lean Six Sigma is sold both as one full day and as two evenings,
  //     but a course carries only ONE timing template and it describes the full
  //     day. Building the evening run from it puts a 09:15 session on an evening
  //     class and leaves the second night with no session to take attendance
  //     against. Wrong times are worse than a refusal.
  //
  // Either way the honest answer is that this run cannot be built from the
  // template we have, and someone needs to add the missing one.
  if (anchored && (parsed as string[]).length !== dayCount) {
    return { mismatch: { templateDays: dayCount, runDays: (parsed as string[]).length } };
  }

  const usable = anchored && (parsed as string[]).length === dayCount;
  const dates = usable ? (parsed as string[]) : teachingDates(dayCount, startDate, endDate);

  // Without a readable label we fall back to start/end, which cannot always
  // supply enough distinct days either.
  if (dates.length < dayCount) {
    return { mismatch: { templateDays: dayCount, runDays: dates.length } };
  }

  return slots.map((sl) => {
    const date = dates[sl.day];
    return {
      startDate: date,
      endDate: date,
      startTime: sl.startTime,
      endTime: sl.endTime,
      modeOfTraining: sl.modeOfTraining,
    };
  });
};

export const VENUE = { floor: '07', unit: '85-87', postalCode: '737715', room: 'Training room' };

/**
 * Work out the sessions a run would be given - without submitting anything.
 *
 * Exported so the dry-run preview shows the SAME times the real submission uses.
 * A preview that omits them asks a person to approve dates and take the times on
 * trust, which is not an informed approval; and a second implementation of this
 * logic would drift from the one that actually runs.
 *
 * `cache` lets one request cost a couple of queries instead of one per date when
 * previewing many dates for the same course.
 */
export type SessionBuildCache = {
  timing: Map<string, Record<string, any> | null>;
  pattern: Map<string, PastPattern | null>;
};
export const newSessionBuildCache = (): SessionBuildCache => ({ timing: new Map(), pattern: new Map() });

export type BuiltRunSessions =
  | { ok: true; sessions: BuiltSession[] }
  | { ok: false; reason: string };

export async function buildRunSessions(
  courseId: string,
  course_code: string,
  start_date: string,
  end_date: string,
  raw?: string,
  cache?: SessionBuildCache,
): Promise<BuiltRunSessions> {
  // Resolve the timing template through the COURSE, not the literal code we were
  // handed. Funding renewal issues a new course reference number and the
  // storefront switches to it at once, but the timing template stays filed under
  // whichever code it was created with - measured 26 Aug 2026, all 36 renewed
  // courses had their template under the OLD code and none under the new one, so
  // a literal match found nothing and every one of them failed here as
  // "No session timing template found" without ever reaching SSG.
  // Prefer an exact match on the supplied code, then fall back to any other code
  // the same course carries.
  const timingKey = `${courseId}|${course_code}`;
  let timing: Record<string, any> | null;
  if (cache && cache.timing.has(timingKey)) {
    timing = cache.timing.get(timingKey)!;
  } else {
    const timingRow = await pool.query<Record<string, any>>(
      `SELECT t.*
         FROM course_session_timing t
        WHERE t.course_code = $1
           OR t.course_code = (SELECT c.course_code FROM course c WHERE c.id = $2)
           OR t.course_code IN (SELECT h.code FROM course_code_history h WHERE h.course_id = $2)
        ORDER BY (t.course_code = $1) DESC
        LIMIT 1`,
      [course_code, courseId],
    ).catch(() => ({ rows: [] as Record<string, any>[] }));
    // A missing template is NOT fatal on its own. Cloning the course's own last run
    // is the preferred source of session times and needs no template at all, so the
    // "no timing" verdict is deferred until that has been tried too - bailing here
    // refused courses with a full history of real sessions purely because a form had
    // never been filled in.
    timing = timingRow.rows[0] ?? null;
    if (cache) cache.timing.set(timingKey, timing);
  }

  // How many days is this run taught over, and is it an evening class? Both come
  // from the storefront label; the dates are the fallback when it cannot be read.
  const wantEvening = /\bevening\b/i.test(raw ?? '');
  const labelDates = parseRawDates(raw ?? '');
  const teachingDays = labelDates
    && labelDates[0] === start_date
    && labelDates[labelDates.length - 1] === end_date
      ? labelDates.length
      : null;

  // Clone the shape this course last actually ran, matched on day count and
  // day/evening. Falls back to the template only for daytime runs - the template
  // IS the daytime pattern, so using it for an evening class would put a 09:15
  // session on a class that starts at 18:00.
  let pattern: PastPattern | null = null;
  if (teachingDays) {
    const patternKey = `${courseId}|${teachingDays}|${wantEvening}`;
    if (cache && cache.pattern.has(patternKey)) {
      pattern = cache.pattern.get(patternKey)!;
    } else {
      pattern = await pastSessionPattern(courseId, teachingDays, wantEvening);
      if (cache) cache.pattern.set(patternKey, pattern);
    }
  }

  // Now both sources have been tried: nothing to clone and nothing to build from.
  if (!timing && !pattern) {
    return { ok: false, reason: 'No session timing template found, and this course has no past run of the same shape to copy' };
  }

  // No evening history for this course - derive the pattern from its daytime
  // template instead of refusing. Cloning real history is still preferred; this
  // only fills the gap for a course running its first evening class.
  // Deriving repacks the DAYTIME template's session lengths into evenings, so it
  // needs a template - a course with neither template nor evening history cannot
  // be derived and falls through to the refusal below.
  let effectivePattern = pattern;
  if (wantEvening && !effectivePattern && teachingDays && timing) {
    const daySlots: { startTime: string; endTime: string; modeOfTraining: string }[] = [];
    for (let i = 1; i <= 11; i++) {
      const st = (timing[`session_${i}_start_time`] || '').trim();
      const en = (timing[`session_${i}_end_time`] || '').trim();
      if (!st && !en) break;
      daySlots.push({
        startTime: st,
        endTime: en,
        modeOfTraining: normalizeModeOfTraining(timing[`session_${i}_mode_of_training`]),
      });
    }
    const derived = deriveEveningPattern(daySlots, teachingDays);
    if (derived.length > 0) effectivePattern = derived;
  }

  if (wantEvening && !effectivePattern) {
    return {
      ok: false,
      reason:
        `This run is sold as an evening class (${raw}) but this course has no ` +
        `evening history to clone, and its daytime timings do not fit into evening ` +
        `sessions - the course is too long for the number of evenings offered. ` +
        `Create one evening run by hand so the rest can be cloned from it.`,
    };
  }

  const built = buildSessions(timing ?? {}, start_date, end_date, raw, effectivePattern);
  if ('mismatch' in built) {
    const { templateDays, runDays } = built.mismatch;
    const when = raw || `${start_date} to ${end_date}`;
    return {
      ok: false,
      reason: runDays < templateDays
        ? `The session timing template covers ${templateDays} day(s) but this run only offers ${runDays} (${when}). ` +
          `The dates on the storefront look wrong.`
        : `This run is sold over ${runDays} day(s) but the session timing template only covers ${templateDays} (${when}). ` +
          `This format needs its own timing template - building it from the existing one would put the class at the wrong time of day.`,
    };
  }
  if (!built.length) {
    return { ok: false, reason: 'Session timing template has no sessions' };
  }
  return { ok: true, sessions: built };
}

// ── Per-item processor ────────────────────────────────────────────────────────

async function processItem(
  item: SubmitItem,
  credentials: SSGCredentials,
  ssgBaseUrl: string,
  companyEmail: string,
  todaySg: string,
): Promise<ItemResult> {
  const { start_date, end_date } = item;
  // MMS can send course codes with stray whitespace (e.g. a trailing tab) that
  // breaks the exact-match lookup and pollutes the SSG courseReferenceNumber.
  const course_code = (item.course_code ?? '').trim();

  const courseRow = await pool.query<{ id: string }>(
    COURSE_ID_BY_ANY_CODE_SQL, [course_code],
  ).catch(() => ({ rows: [] as { id: string }[] }));
  if (!courseRow.rows[0]) {
    return { course_code, start_date, end_date, status: 'no_course', message: 'Course not found in LMS' };
  }
  const courseId = courseRow.rows[0].id;

  const existingRow = await pool.query<{ id: string; course_run_id: string }>(
    `SELECT id, course_run_id FROM course_run
      WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
        AND is_deleted = false AND course_run_id NOT LIKE 'STAGED-%'
      LIMIT 1`,
    [courseId, start_date, end_date],
  ).catch(() => ({ rows: [] as { id: string; course_run_id: string }[] }));
  if (existingRow.rows[0]) {
    return { course_code, start_date, end_date, status: 'exists',
      ssg_run_id: existingRow.rows[0].course_run_id, local_run_id: existingRow.rows[0].id };
  }

  // Session times come from buildRunSessions() so the dry-run preview in
  // /api/external/wsq-submit-runs shows exactly what this will submit, rather
  // than a second implementation that can drift from this one.
  const builtSessions = await buildRunSessions(courseId, course_code, start_date, end_date, item.raw);
  if (!builtSessions.ok) {
    return { course_code, start_date, end_date, status: 'no_session_timing', message: builtSessions.reason };
  }
  const sessions = builtSessions.sessions;

  const regClosing = addDays(start_date, -1);
  const regOpening = todaySg > regClosing ? regClosing : todaySg;
  const toInt = (d: string) => parseInt(d.replace(/-/g, ''), 10);

  const payload = {
    course: {
      courseReferenceNumber: course_code,
      trainingProvider: { uen: credentials.uen },
      runs: [{
        sequenceNumber: 1,
        registrationDates: { opening: toInt(regOpening), closing: toInt(regClosing) },
        courseDates: { start: toInt(start_date), end: toInt(end_date) },
        scheduleInfoType: { code: '01', description: 'Description' },
        scheduleInfo: 'Refer to our website for course schedule details.',
        venue: VENUE,
        modeOfTraining: sessions[0].modeOfTraining,
        courseAdminEmail: companyEmail,
        courseVacancy: { code: 'A', description: 'Available' },
        sessions: sessions.map(s => ({
          modeOfTraining: s.modeOfTraining, startDate: s.startDate, endDate: s.endDate,
          startTime: s.startTime, endTime: s.endTime, venue: VENUE,
        })),
      }],
    },
  };

  let ssgRunId: string | null = null;
  try {
    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/courses/courseRuns/publish')
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json')
      .withParam('includeExpiredCourses', 'false');
    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }
    builder.withBody(Cryptography.encryptJSON(credentials.encryptionKey, payload));
    const config = builder.build();
    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
    const result = await handleRequest(httpClient, config);

    const hasError = result.error && (
      result.error.code || result.error.message ||
      (result.error.details && result.error.details.length > 0)
    );
    if (hasError) {
      const errMsg = result.error?.details?.[0]?.message || result.error?.message || 'SSG returned error';
      const alreadyMatch = errMsg.match(/Course Run ID is (\d+)/i);
      if (alreadyMatch) {
        ssgRunId = alreadyMatch[1];
      } else {
        return { course_code, start_date, end_date, status: 'ssg_error', message: errMsg };
      }
    }
    if (!ssgRunId) {
      const data = result.data as any;
      ssgRunId = data?.course?.runs?.[0]?.runId ?? data?.data?.course?.runs?.[0]?.runId
        ?? data?.runs?.[0]?.runId ?? data?.runs?.[0]?.id ?? data?.runId ?? null;
      if (ssgRunId != null) ssgRunId = String(ssgRunId);
      if (!ssgRunId) {
        return { course_code, start_date, end_date, status: 'ssg_error',
          message: `SSG did not return a run ID. Response: ${JSON.stringify(result.data ?? result).slice(0, 300)}` };
      }
    }
  } catch (e: any) {
    return { course_code, start_date, end_date, status: 'ssg_error', message: e?.message || 'SSG request failed' };
  }

  let localRunId: string | null = null;
  try {
    const stagedRow = await pool.query<{ id: string }>(
      `SELECT id FROM course_run
        WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
          AND is_deleted = false AND course_run_id LIKE 'STAGED-%' LIMIT 1`,
      [courseId, start_date, end_date],
    );
    if (stagedRow.rows[0]) {
      await pool.query(
        `UPDATE course_run SET course_run_id = $1, class_status = 'Confirmed',
           registration_opening_date = $2::date, registration_closing_date = $3::date,
           venue_floor = $4, venue_unit = $5, venue_postal_code = $6, venue_room = $7,
           course_admin_email = $8, updated_at = NOW() WHERE id = $9`,
        [ssgRunId, regOpening, regClosing, VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail, stagedRow.rows[0].id],
      );
      localRunId = stagedRow.rows[0].id;
    } else {
      const byRunId = await pool.query<{ id: string }>(
        `SELECT id FROM course_run WHERE course_id = $1 AND course_run_id = $2 AND is_deleted = false LIMIT 1`,
        [courseId, ssgRunId],
      );
      if (byRunId.rows[0]) {
        await pool.query(
          `UPDATE course_run SET start_date = $1::date, end_date = $2::date, class_status = 'Confirmed',
             registration_opening_date = $3::date, registration_closing_date = $4::date,
             venue_floor = $5, venue_unit = $6, venue_postal_code = $7, venue_room = $8,
             course_admin_email = $9, updated_at = NOW() WHERE id = $10`,
          [start_date, end_date, regOpening, regClosing, VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail, byRunId.rows[0].id],
        );
        localRunId = byRunId.rows[0].id;
      } else {
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO course_run (
             course_id, course_run_id, start_date, end_date, class_status,
             registration_opening_date, registration_closing_date,
             venue_floor, venue_unit, venue_postal_code, venue_room,
             course_admin_email, created_at, updated_at
           ) VALUES ($1,$2,$3::date,$4::date,'Confirmed',$5::date,$6::date,$7,$8,$9,$10,$11,NOW(),NOW())
           RETURNING id`,
          [courseId, ssgRunId, start_date, end_date, regOpening, regClosing,
           VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail],
        );
        localRunId = inserted.rows[0].id;
      }
    }
  } catch (e: any) {
    return { course_code, start_date, end_date, status: 'submitted', ssg_run_id: ssgRunId,
      message: `SSG OK but local DB save failed: ${e?.message}` };
  }

  return { course_code, start_date, end_date, status: 'submitted',
    ssg_run_id: ssgRunId, local_run_id: localRunId ?? undefined };
}

// ── Background orchestrator ───────────────────────────────────────────────────

const BATCH_SIZE = 100;

async function runInBackground(
  jobId: number,
  items: SubmitItem[],
  credentials: SSGCredentials,
  ssgBaseUrl: string,
  companyEmail: string,
) {
  const todaySg = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }),
  ).toISOString().split('T')[0];

  let totalSubmitted = 0, totalExists = 0, totalSsgErrors = 0, totalSkipped = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results: ItemResult[] = [];
    for (const item of batch) {
      results.push(await processItem(item, credentials, ssgBaseUrl, companyEmail, todaySg));
    }

    const batchSubmitted = results.filter(r => r.status === 'submitted').length;
    const batchExists    = results.filter(r => r.status === 'exists').length;
    const batchSsgErrors = results.filter(r => r.status === 'ssg_error').length;
    const batchSkipped   = results.filter(r => ['error', 'no_course', 'no_session_timing'].includes(r.status)).length;
    const batchFailures  = results.filter(r => !['submitted', 'exists'].includes(r.status));

    totalSubmitted += batchSubmitted;
    totalExists    += batchExists;
    totalSsgErrors += batchSsgErrors;
    totalSkipped   += batchSkipped;

    await pool.query(
      `UPDATE wsq_sync_job SET
         items_done     = items_done     + $1,
         submitted      = submitted      + $2,
         already_exists = already_exists + $3,
         ssg_errors     = ssg_errors     + $4,
         skipped        = skipped        + $5,
         failures       = failures       || $6::jsonb
       WHERE id = $7`,
      [batch.length, batchSubmitted, batchExists, batchSsgErrors, batchSkipped,
       JSON.stringify(batchFailures), jobId],
    );
  }

  const parts: string[] = [];
  if (totalSubmitted) parts.push(`${totalSubmitted} submitted`);
  if (totalExists)    parts.push(`${totalExists} already existed`);
  if (totalSsgErrors) parts.push(`${totalSsgErrors} SSG errors`);
  if (totalSkipped)   parts.push(`${totalSkipped} skipped`);

  await pool.query(
    `UPDATE wsq_sync_job SET status = 'completed', completed_at = NOW(), summary = $1 WHERE id = $2`,
    [parts.join(' · ') || 'Done', jobId],
  );
}

// ── Start a sync job (shared by the manual endpoint and the daily cron) ────────

export type StartWsqSyncResult =
  | { started: true; jobId: number; totalItems: number }
  | { started: false; reason: 'already_running'; jobId: number }
  | { started: false; reason: 'not_configured'; message: string };

/**
 * Create a wsq_sync_job and process `items` in the background (fire-and-forget).
 * Shared by the manual POST handler and the daily cron (auto-sync-wsq-schedule).
 * Idempotent per-item (processItem skips runs that already exist), and blocks if
 * another job is already running.
 */
export async function startWsqSyncJob(
  items: SubmitItem[],
  triggeredBy: 'user' | 'cron',
  ssgApp?: string,
): Promise<StartWsqSyncResult> {
  // Auto-expire jobs stuck in "running" for more than 15 minutes — from a
  // previous process killed mid-sync (redeploy, crash, etc.).
  await pool.query(
    `UPDATE wsq_sync_job
       SET status = 'failed', completed_at = NOW(),
           summary = 'Interrupted — server restarted or redeployed'
     WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 minutes'`,
  ).catch(() => {});

  // Block if a fresh job is already running.
  const existing = await pool.query(
    `SELECT id FROM wsq_sync_job WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { started: false, reason: 'already_running', jobId: existing.rows[0].id };
  }

  // Load SSG credentials.
  let ssgBaseUrl = 'https://api.ssg-wsg.sg';
  let companyEmail = 'enquiry@tertiaryinfotech.com';
  const creds = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!creds)                return { started: false, reason: 'not_configured', message: 'SSG credentials not configured' };
  if (!creds.encryptionKey)  return { started: false, reason: 'not_configured', message: 'SSG encryption key missing' };
  if (!creds.certificateContent || !creds.privateKeyContent) {
    return { started: false, reason: 'not_configured', message: 'SSG certificate/key missing' };
  }
  const credentials: SSGCredentials = creds;
  ssgBaseUrl = creds.ssgApiBaseUrl || ssgBaseUrl;
  try {
    const tpRow = await pool.query<{ company_email: string }>(`SELECT company_email FROM training_provider LIMIT 1`);
    if (tpRow.rows[0]?.company_email) companyEmail = tpRow.rows[0].company_email;
  } catch { /* keep default */ }

  // Create job row + process in the background (survives the caller returning).
  const jobResult = await pool.query<{ id: number }>(
    `INSERT INTO wsq_sync_job (total_items, triggered_by) VALUES ($1, $2) RETURNING id`,
    [items.length, triggeredBy],
  );
  const jobId = jobResult.rows[0].id;

  void runInBackground(jobId, items, credentials, ssgBaseUrl, companyEmail).catch(async (e) => {
    await pool.query(
      `UPDATE wsq_sync_job SET status = 'failed', completed_at = NOW(), summary = $1 WHERE id = $2`,
      [`Fatal error: ${e?.message || e}`, jobId],
    ).catch(() => {});
  });

  return { started: true, jobId, totalItems: items.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const items: SubmitItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const triggeredBy = req.body?.triggered_by === 'cron' ? 'cron' : 'user';

  if (items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const result = await startWsqSyncJob(items, triggeredBy, (req.headers['x-ssg-app'] as string) || undefined);
  if (result.started) {
    return res.status(200).json({ job_id: result.jobId, total_items: result.totalItems });
  }
  if (result.reason === 'already_running') {
    return res.status(409).json({ error: 'A sync is already running', job_id: result.jobId });
  }
  return res.status(503).json({ error: result.message });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
