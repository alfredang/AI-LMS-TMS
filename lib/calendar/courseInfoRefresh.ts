import type { calendar_v3 } from 'googleapis';
import { enrichCalendarCourseDescription, readCalendarCourseInfo, descriptionText, type CalendarCourseInfo } from './courseInfoDescription';

export interface CourseInfoRun extends CalendarCourseInfo {
  id: string;
  startDate: string;
  endDate: string;
  active: boolean;
  sessionDates: string[];
  mappings: { eventId: string; date: string }[];
  startTime?: string;
  endTime?: string;
}
type Event = calendar_v3.Schema$Event;
export interface CourseInfoRefreshDependencies {
  runs(): Promise<CourseInfoRun[]>;
  events(): Promise<Event[]>;
  get(eventId: string): Promise<Event>;
  patch(eventId: string, description: string, etag: string): Promise<void>;
  lock<T>(runId: string, fn: () => Promise<T>): Promise<T>;
  /** Read-only per-SKU MMS schedule; the existing refresh caches both reads. */
  mmsCourse?(code: string): Promise<unknown>;
}
export interface CourseInfoRefreshResult {
  status: 'ok' | 'skipped';
  reason?: string;
  scanned: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  errors: number;
  nonFunded?: { scanned: number; updated: number; unchanged: number; conflicts: number; skipped: number; errors: number };
  details: { eventId: string; courseRunId?: string; mmsClassId?: string; courseCode?: string; status: string; reason?: string; proposedDescription?: string }[];
}
export const emptyCourseInfoRefresh = (): CourseInfoRefreshResult => ({ status: 'ok', scanned: 0, updated: 0,
  unchanged: 0, conflicts: 0, skipped: 0, errors: 0, details: [] });

const dateOf = (event: Event) => {
  if (!event.start?.dateTime) return event.start?.date || '';
  const date = new Date(event.start.dateTime);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
};
const eligible = (run: CourseInfoRun) => run.active && /^TGS-\d+$/i.test(run.courseCode || '')
  && (!run.courseRunId || /^\d+$/.test(run.courseRunId));
function identify(event: Event, runs: CourseInfoRun[], inventory: Event[]): { run?: CourseInfoRun; conflict?: string } {
  const date = dateOf(event);
  const fields = readCalendarCourseInfo((event.description || '') + '\n' + (event.location || ''));
  if (fields.mmsClassId.length) return { conflict: 'mms_identity_on_funded_path' };
  const codes = [...new Set([...(fields.courseCode || []),
    ...(descriptionText(event.description || '').match(/\bTGS-\d+\b/gi) || [])].map(c => c.toUpperCase()))];
  const compatible = (run: CourseInfoRun) => {
    const aliases = [run.courseCode, ...(run.courseCodeAliases || [])].map(code => code?.toUpperCase());
    return !codes.length || codes.every(code => aliases.includes(code));
  };
  const onDate = (run: CourseInfoRun) => date >= run.startDate && date <= run.endDate;
  const mapped = runs.filter(run => run.mappings.some(m => m.eventId === event.id));
  if (mapped.length) {
    if (mapped.length !== 1) return { conflict: 'multiple_mappings' };
    const run = mapped[0];
    if (!eligible(run) || !compatible(run) || !onDate(run)
      || !run.mappings.some(m => m.eventId === event.id && m.date === date)
      || fields.courseRunId.some(id => id !== run.courseRunId)) return { conflict: 'mapping_identity_conflict' };
    return { run };
  }
  const candidates = runs.filter(run => {
    if (!eligible(run) || !onDate(run) || !compatible(run)) return false;
    if (fields.courseRunId.length) return fields.courseRunId.every(id => id === run.courseRunId);
    if (!run.courseRunId) return false; // Partial source data is usable only with an existing exact mapping.
    if (!codes.length) return false; // Title similarity alone is never sufficient for enrichment.
    if (run.sessionDates.length) return run.sessionDates.includes(date);
    // Without local sessions, require the observed full series boundaries to agree.
    const group = event.recurringEventId ? inventory.filter(e => e.recurringEventId === event.recurringEventId && e.status !== 'cancelled') : [event];
    if (group.some(e => {
      const other = readCalendarCourseInfo((e.description || '') + '\n' + (e.location || ''));
      const aliases = [run.courseCode, ...(run.courseCodeAliases || [])].map(code => code?.toUpperCase());
      const otherCodes = [...other.courseCode, ...(descriptionText(e.description || '').match(/\bTGS-\d+\b/gi) || [])];
      return other.courseRunId.some(id => id !== run.courseRunId) || otherCodes.some(code => !aliases.includes(code.toUpperCase()));
    })) return false;
    const dates = group.map(dateOf).filter(Boolean).sort();
    return dates[0] === run.startDate && dates[dates.length - 1] === run.endDate;
  });
  if (candidates.length > 1) return { conflict: 'multiple_possible_runs' };
  if (!candidates.length && fields.courseRunId.length) return { conflict: 'unverified_existing_run_id' };
  return { run: candidates[0] };
}

/** Only labelled codes or the standalone legacy description (e.g. C1097) are evidence.
 * Never interpret an MMS Class ID, a note mentioning a course, or a similar title as a code. */
function mmsEventCodes(event: Event): string[] {
  const text = (event.description || '') + '\n' + (event.location || '');
  const codes = readCalendarCourseInfo(text).courseCode;
  const lines = descriptionText(text.replace(/<br\b[^>]*>|<\/?(?:p|div|li)\b[^>]*>/gi, '\n')).split(/[\r\n]+/);
  return [...new Set([...codes, ...lines.filter(line => /^\s*(?:C\d+|TGS-\d+)\s*$/i.test(line))].map(code => code.trim().toUpperCase()))];
}

const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

/** Parse explicit teaching days, never expand a start/end range into invented sessions.
 * Supported labels include 27/30 Nov 2026, 29 Jan / 1 Feb 2027 and ISO day lists. */
export function mmsTeachingDates(raw: unknown, start: string, end: string): string[] | null {
  if (!isoDate(start) || !isoDate(end) || end < start) return null;
  if (raw == null || raw === '') return start === end ? [start] : null;
  if (typeof raw !== 'string') return null;
  const label = raw.trim().replace(/\s*\((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z /,&-]*\)\s*$/i, '').trim();
  let dates: string[] = [];
  if (/^\d{4}-\d{2}-\d{2}(?:\s*[,/]\s*\d{4}-\d{2}-\d{2})*$/.test(label)) {
    dates = label.split(/\s*[,/]\s*/);
  } else {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let month = '', year = '';
    for (const part of label.split(/\s*[/,&]\s*/).reverse()) {
      const match = part.trim().match(/^(\d{1,2})(?:\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?))?(?:\s+(\d{4}))?$/i);
      if (!match) return null;
      if (match[2]) month = String(months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1).padStart(2, '0');
      if (match[3]) year = match[3];
      if (!month || !year) return null;
      dates.unshift(`${year}-${month}-${match[1].padStart(2, '0')}`);
    }
  }
  if (!dates.length || dates.some(date => !isoDate(date)) || new Set(dates).size !== dates.length
    || dates.some((date, index) => index > 0 && date <= dates[index - 1]) || dates[0] !== start || dates[dates.length - 1] !== end) return null;
  return dates;
}

function mmsRuns(code: string, payload: unknown): CourseInfoRun[] {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data.course_code !== 'string' || data.course_code.trim().toUpperCase() !== code
    || typeof data.course_title !== 'string' || !data.course_title.trim() || !Array.isArray(data.classes)
    || data.classes_count !== data.classes.length) throw new Error('mms_invalid_response');
  // This API caps materialized runs at 50. Do not claim uniqueness from a potentially truncated list.
  if (data.classes.filter(row => row?.class_id != null).length >= 50) throw new Error('mms_schedule_may_be_truncated');
  return data.classes.map((row: Record<string, unknown>): CourseInfoRun => {
    if (!row || !isoDate(row.start_date) || !isoDate(row.end_date) || row.end_date < row.start_date
      || typeof row.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(row.time)
      || (row.class_id != null && (typeof row.class_id !== 'string' || !/^(?:C|[A-Z]{2})\d{6,}$/.test(row.class_id)))) {
      throw new Error('mms_invalid_response');
    }
    const [startTime, endTime] = row.time.split('-');
    if (endTime <= startTime) throw new Error('mms_invalid_response');
    return { id: `mms:${code}:${row.start_date}:${row.end_date}:${row.time}`, title: data.course_title as string,
      courseCode: code, mmsClassId: row.class_id as string | null, startDate: row.start_date, endDate: row.end_date,
      startTime, endTime, active: !/cancel|deleted/i.test(String(row.status || '')),
      sessionDates: mmsTeachingDates(row.raw, row.start_date, row.end_date) || [], mappings: [] };
  });
}

function mmsTime(event: Event, end = false): string {
  const value = (end ? event.end : event.start)?.dateTime;
  if (!value || !Number.isFinite(Date.parse(value)) || Date.parse(value) % 60_000 !== 0) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function identifyMms(event: Event, runs: CourseInfoRun[], inventory: Event[], code: string): { run?: CourseInfoRun; conflict?: string; reason?: string } {
  const group = event.recurringEventId ? inventory.filter(e => e.recurringEventId === event.recurringEventId && e.status !== 'cancelled') : [event];
  const compatible = (entry: Event, run: CourseInfoRun) => {
    const fields = readCalendarCourseInfo((entry.description || '') + '\n' + (entry.location || ''));
    const codes = mmsEventCodes(entry);
    return codes.length === 1 && codes[0] === code && !fields.courseRunId.length
      && fields.mmsClassId.every(id => id === run.mmsClassId)
      && run.sessionDates.includes(dateOf(entry)) && dateOf({ start: entry.end }) === dateOf(entry)
      && mmsTime(entry) === run.startTime && mmsTime(entry, true) === run.endTime;
  };
  const candidates = runs.filter(run => run.active && compatible(event, run) && group.every(entry => compatible(entry, run))
    && (!event.recurringEventId || (group.length === run.sessionDates.length
      && run.sessionDates.every(date => group.filter(e => dateOf(e) === date).length === 1))));
  if (candidates.length > 1) return { conflict: 'multiple_possible_mms_classes' };
  if (!candidates.length) {
    const fields = readCalendarCourseInfo((event.description || '') + '\n' + (event.location || ''));
    if (fields.mmsClassId.length || fields.courseRunId.length) return { conflict: 'mms_identity_or_schedule_conflict' };
    return { reason: runs.some(run => !run.sessionDates.length) ? 'mms_teaching_dates_unavailable' : 'mms_class_not_matched' };
  }
  return { run: candidates[0], reason: candidates[0].mmsClassId ? undefined : 'mms_class_id_unavailable' };
}

/** Uses the existing job's invocation; no event creation, mapping adoption or attendee changes. */
export async function refreshExistingCalendarCourseInfo(deps: CourseInfoRefreshDependencies,
  options: { courseRunId?: string; now?: Date; dryRun?: boolean } = {}): Promise<CourseInfoRefreshResult> {
  const out = emptyCourseInfoRefresh();
  const [runs, events] = await Promise.all([deps.runs(), deps.events()]);
  const initialMms = new Map<string, Promise<CourseInfoRun[]>>(), freshMms = new Map<string, Promise<CourseInfoRun[]>>();
  const loadMms = (code: string, fresh = false) => {
    const cache = fresh ? freshMms : initialMms;
    if (!cache.has(code)) cache.set(code, deps.mmsCourse ? deps.mmsCourse(code).then(payload => mmsRuns(code, payload)) : Promise.reject(new Error('mms_api_unconfigured')));
    return cache.get(code)!;
  };
  // Up to four read requests at a time, once per SKU (and once more for pre-write validation).
  // Errors stay on their C-code events; they never abort funded-course/enrolment processing.
  const codes = options.courseRunId ? [] : [...new Set(events.filter(e => e.id && e.status !== 'cancelled')
    .flatMap(mmsEventCodes).filter(code => /^C\d+$/.test(code)))];
  let nextCode = 0;
  await Promise.all(Array.from({ length: Math.min(4, codes.length) }, async () => {
    while (nextCode < codes.length) { const code = codes[nextCode++]; await loadMms(code).catch(() => undefined); }
  }));
  const record = (event: Event, status: string, reason?: string, run?: CourseInfoRun, proposedDescription?: string) => {
    if (out.details.length < 100) out.details.push({ eventId: event.id || '', courseRunId: run?.courseRunId || undefined,
      mmsClassId: run?.mmsClassId || undefined, courseCode: run?.courseCode || undefined, status, reason, proposedDescription });
  };
  const mmsError = (error: unknown) => {
    const message = (error as Error)?.message;
    return ['mms_api_unconfigured', 'mms_invalid_response', 'mms_schedule_may_be_truncated'].includes(message) ? message : 'mms_api_unavailable';
  };
  for (const event of events) {
    if (!event.id || event.status === 'cancelled') continue;
    const eventCodes = mmsEventCodes(event);
    const isMms = !options.courseRunId && eventCodes.some(code => /^C\d+$/.test(code));
    const mmsCode = isMms && eventCodes.length === 1 ? eventCodes[0] : '';
    let match: { run?: CourseInfoRun; conflict?: string; reason?: string };
    if (isMms) {
      out.nonFunded ||= { scanned: 0, updated: 0, unchanged: 0, conflicts: 0, skipped: 0, errors: 0 };
      out.nonFunded.scanned++;
      if (!mmsCode) match = { conflict: 'conflicting_mms_course_codes' };
      else {
        try { match = identifyMms(event, await loadMms(mmsCode), events, mmsCode); }
        catch (error) {
          out.scanned++; out.errors++; out.nonFunded.errors++; record(event, 'error', mmsError(error)); continue;
        }
      }
    } else match = identify(event, runs, events);
    if (options.courseRunId && match.run?.id !== options.courseRunId && match.run?.courseRunId !== options.courseRunId) {
      const target = runs.find(r => r.id === options.courseRunId || r.courseRunId === options.courseRunId);
      if (!match.conflict || !target?.mappings.some(m => m.eventId === event.id)) continue;
    }
    out.scanned++;
    const count = (key: 'updated' | 'unchanged' | 'conflicts' | 'skipped' | 'errors') => { out[key]++; if (isMms) out.nonFunded![key]++; };
    if (match.conflict) { count('conflicts'); record(event, 'conflict', match.conflict); continue; }
    if (!match.run) { count('skipped'); if (isMms) record(event, 'skipped', match.reason); continue; }
    const initial = enrichCalendarCourseDescription(event.description, match.run, options.now);
    if (initial.status === 'conflict') { count('conflicts'); record(event, 'conflict', initial.reason, match.run); continue; }
    if (initial.status === 'unchanged') { count('unchanged'); if (isMms) record(event, 'unchanged', match.reason, match.run); continue; }
    try {
      await deps.lock(isMms ? `mms:${mmsCode}` : match.run.id, async () => {
        // Do not patch stale list data or trust a mapping that changed during this pass.
        const [fresh, currentRuns] = await Promise.all([deps.get(event.id!), isMms ? loadMms(mmsCode, true) : deps.runs()]);
        const inventory = events.map(e => e.id === fresh.id ? fresh : e);
        const current = isMms ? identifyMms(fresh, currentRuns, inventory, mmsCode) : identify(fresh, currentRuns, inventory);
        if (fresh.id !== event.id || fresh.status === 'cancelled' || !current.run || current.run.id !== match.run!.id || current.conflict) {
          count('conflicts'); record(event, 'conflict', current.conflict || 'identity_changed', match.run); return;
        }
        if (isMms && current.run.mmsClassId !== match.run!.mmsClassId) {
          count('conflicts'); record(event, 'conflict', 'mms_class_id_changed', match.run); return;
        }
        const update = enrichCalendarCourseDescription(fresh.description, current.run, options.now);
        if (update.status === 'unchanged') { count('unchanged'); return; }
        if (update.status === 'conflict') {
          count('conflicts'); record(event, 'conflict', update.reason, current.run); return;
        }
        if (options.dryRun) { count('skipped'); record(event, 'would_update', match.reason, current.run, update.description); return; }
        if (!fresh.etag) { count('conflicts'); record(event, 'conflict', 'missing_event_version', current.run); return; }
        await deps.patch(event.id!, update.description, fresh.etag);
        const verified = await deps.get(event.id!);
        if (verified.status === 'cancelled' || verified.description !== update.description) throw new Error('description_readback_mismatch');
        count('updated'); record(event, 'updated', match.reason, current.run);
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 412) { count('conflicts'); record(event, 'conflict', 'event_changed'); }
      else if ((error as Error).name === 'LegacyCalendarWriteQueuedError') {
        count('skipped'); record(event, 'skipped', 'operational_writer_owns_calendar');
      } else { count('errors'); record(event, 'error', isMms && (error as Error).message?.startsWith('mms_') ? mmsError(error) : 'description_update_failed'); }
    }
  }
  return out;
}
