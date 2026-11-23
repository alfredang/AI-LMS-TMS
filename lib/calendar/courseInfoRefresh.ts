import type { calendar_v3 } from 'googleapis';
import { enrichCalendarCourseDescription, readCalendarCourseInfo, descriptionText, type CalendarCourseInfo } from './courseInfoDescription';

export interface CourseInfoRun extends CalendarCourseInfo {
  id: string;
  startDate: string;
  endDate: string;
  active: boolean;
  sessionDates: string[];
  mappings: { eventId: string; date: string }[];
}
type Event = calendar_v3.Schema$Event;
export interface CourseInfoRefreshDependencies {
  runs(): Promise<CourseInfoRun[]>;
  events(): Promise<Event[]>;
  get(eventId: string): Promise<Event>;
  patch(eventId: string, description: string, etag: string): Promise<void>;
  lock<T>(runId: string, fn: () => Promise<T>): Promise<T>;
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
  details: { eventId: string; courseRunId?: string; status: string; reason?: string }[];
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

/** Uses the existing job's invocation; no event creation, mapping adoption or attendee changes. */
export async function refreshExistingCalendarCourseInfo(deps: CourseInfoRefreshDependencies,
  options: { courseRunId?: string; now?: Date } = {}): Promise<CourseInfoRefreshResult> {
  const out = emptyCourseInfoRefresh();
  const [runs, events] = await Promise.all([deps.runs(), deps.events()]);
  const record = (event: Event, status: string, reason?: string, run?: CourseInfoRun) => {
    if (out.details.length < 100) out.details.push({ eventId: event.id || '', courseRunId: run?.courseRunId || undefined, status, reason });
  };
  for (const event of events) {
    if (!event.id || event.status === 'cancelled') continue;
    const match = identify(event, runs, events);
    if (options.courseRunId && match.run?.id !== options.courseRunId && match.run?.courseRunId !== options.courseRunId) {
      const target = runs.find(r => r.id === options.courseRunId || r.courseRunId === options.courseRunId);
      if (!match.conflict || !target?.mappings.some(m => m.eventId === event.id)) continue;
    }
    out.scanned++;
    if (match.conflict) { out.conflicts++; record(event, 'conflict', match.conflict); continue; }
    if (!match.run) { out.skipped++; continue; }
    const initial = enrichCalendarCourseDescription(event.description, match.run, options.now);
    if (initial.status === 'conflict') { out.conflicts++; record(event, 'conflict', initial.reason, match.run); continue; }
    if (initial.status === 'unchanged') { out.unchanged++; continue; }
    try {
      await deps.lock(match.run.id, async () => {
        // Do not patch stale list data or trust a mapping that changed during this pass.
        const [fresh, currentRuns] = await Promise.all([deps.get(event.id!), deps.runs()]);
        const current = identify(fresh, currentRuns, events.map(e => e.id === fresh.id ? fresh : e));
        if (fresh.id !== event.id || fresh.status === 'cancelled' || !current.run || current.run.id !== match.run!.id || current.conflict) {
          out.conflicts++; record(event, 'conflict', current.conflict || 'identity_changed', match.run); return;
        }
        const update = enrichCalendarCourseDescription(fresh.description, current.run, options.now);
        if (update.status === 'unchanged') { out.unchanged++; return; }
        if (update.status === 'conflict' || !fresh.etag) {
          out.conflicts++; record(event, 'conflict', update.reason || 'missing_event_version', current.run); return;
        }
        await deps.patch(event.id!, update.description, fresh.etag);
        const verified = await deps.get(event.id!);
        if (verified.status === 'cancelled' || verified.description !== update.description) throw new Error('description_readback_mismatch');
        out.updated++; record(event, 'updated', undefined, current.run);
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 412) { out.conflicts++; record(event, 'conflict', 'event_changed'); }
      else if ((error as Error).name === 'LegacyCalendarWriteQueuedError') {
        out.skipped++; record(event, 'skipped', 'operational_writer_owns_calendar');
      } else { out.errors++; record(event, 'error', 'description_update_failed'); }
    }
  }
  return out;
}
