import type { calendar_v3 } from 'googleapis';
import { eventDateIso, extractEventCourseCode, extractEventRunId } from './eventMatch';

export interface CandidateRun {
  runUuid: string;
  courseRunId: string;
  courseCode: string | null;
  courseTitle: string;
  startDate: string | null;
  endDate: string | null;
  sessionDates?: string[];
  modeOfLearning?: string | null;
}
export type ResolutionTier = 'durable_mapping' | 'run_id_in_description' | 'course_code' | 'fuzzy_title';
export interface EventMapping { google_event_id: string; course_run_id: string; event_date?: string }
export interface ResolvedEventRun {
  runUuid: string;
  matchedDate: string;
  event: calendar_v3.Schema$Event;
  tier: ResolutionTier;
}
export interface UnresolvedEventRun { event: calendar_v3.Schema$Event; reason: string }

function eventMode(event: calendar_v3.Schema$Event): string | null {
  const text = `${event.summary || ''} ${event.location || ''}`;
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bexternal\b/i.test(text)) return 'external';
  if (/\b(virtual|online)\b/i.test(text)) return 'virtual';
  if (/\b(physical|classroom|woods square|international plaza)\b/i.test(text)) return 'physical';
  if (/meet\.google\.com|zoom\.us/i.test(event.location || '')) return 'virtual';
  return null;
}
function normalizedMode(value: string | null | undefined): string | null {
  const mode = (value || '').toLowerCase();
  return mode === 'classroom' ? 'physical' : mode || null;
}
function conflict(run: CandidateRun, event: calendar_v3.Schema$Event): string | null {
  const date = eventDateIso(event);
  const code = extractEventCourseCode(event);
  const runId = extractEventRunId(event);
  if (runId && runId !== run.courseRunId.toLowerCase()) return 'conflicting_run_id';
  if (code && code !== (run.courseCode || '').trim().toUpperCase()) return 'conflicting_course_code';
  if (!run.startDate || !run.endDate || date < run.startDate || date > run.endDate) return 'outside_run_dates';
  if (run.sessionDates?.length && !run.sessionDates.includes(date)) return 'conflicting_session_date';
  const mode = eventMode(event);
  if (mode && normalizedMode(run.modeOfLearning) && mode !== normalizedMode(run.modeOfLearning)) return 'conflicting_delivery_mode';
  return null;
}

/** Read-only matching. Conflicting identifiers never fall through to weaker matching. */
export function matchEventsToRuns(events: calendar_v3.Schema$Event[], runs: CandidateRun[], mappings: EventMapping[], start: string, end: string) {
  const unresolved: UnresolvedEventRun[] = [];
  const provisional: ResolvedEventRun[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const date = eventDateIso(event);
    if (!date || date < start || date > end || event.status === 'cancelled') continue;
    const reject = (reason: string) => unresolved.push({ event, reason });
    if (!event.id) { reject('missing_event_id'); continue; }
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const mapped = mappings.filter(m => m.google_event_id === event.id);
    const mappedIds = [...new Set(mapped.map(m => m.course_run_id))];
    let candidates: CandidateRun[];
    let tier: ResolutionTier;
    if (mappedIds.length) {
      if (mappedIds.length !== 1 || mapped.some(m => m.event_date && m.event_date !== date)) { reject('conflicting_event_mapping'); continue; }
      candidates = runs.filter(r => r.runUuid === mappedIds[0]);
      tier = 'durable_mapping';
    } else {
      const runId = extractEventRunId(event);
      if (runId) {
        candidates = runs.filter(r => r.courseRunId.toLowerCase() === runId);
        tier = 'run_id_in_description';
      } else {
        const code = extractEventCourseCode(event);
        if (!code) { reject('missing_course_code_and_run_link'); continue; }
        const mode = eventMode(event);
        // Code/date alone does not prove operational correspondence. Require sessions and mode.
        candidates = runs.filter(r => (r.courseCode || '').trim().toUpperCase() === code &&
          !conflict(r, event) && r.sessionDates?.includes(date) && !!mode && normalizedMode(r.modeOfLearning) === mode);
        tier = 'course_code';
      }
    }
    if (candidates.length !== 1) { reject(candidates.length ? 'ambiguous_run_match' : 'unverified_run_match'); continue; }
    const reason = conflict(candidates[0], event);
    if (reason) { reject(reason); continue; }
    provisional.push({ runUuid: candidates[0].runUuid, matchedDate: date, event, tier });
  }
  // Distinct event IDs cannot be silently discarded as duplicates: their guests may disagree.
  const counts = new Map<string, number>();
  for (const r of provisional) { const key = `${r.runUuid}|${r.matchedDate}`; counts.set(key, (counts.get(key) || 0) + 1); }
  const resolved = provisional.filter(r => {
    if (counts.get(`${r.runUuid}|${r.matchedDate}`) === 1) return true;
    unresolved.push({ event: r.event, reason: 'multiple_events_for_run_date' });
    return false;
  });
  return { resolved, unresolved, unresolvedEventIds: unresolved.flatMap(r => r.event.id ? [r.event.id] : []) };
}
