import type { calendar_v3 } from 'googleapis';
import { eventDateIso, extractEventCourseCode } from './eventMatch';
import { matchEventsToRuns, type CandidateRun, type EventMapping } from './eventRunRules';
import { matchGuestIdentity, resolveEventTrainers, type TrainerIdentity, type TrainerResolutionResult } from './trainerIdentityRules';
import { evaluateReminderEligibility, type QueuedReminder, type ReminderDecision, normalizeSgPhone } from './reminderEligibilityRules';
import { sessionAcknowledgement } from './trainerAcknowledgementRules';

export interface ReminderRun extends CandidateRun {
  classStatus: string;
  assignments: Array<{ user_id: string | null; email: string | null; name: string | null }>;
  sessions: Array<{ date: string; trainer_id: string | null }>;
  details: Record<string, any>;
}
export interface ReminderSession {
  runUuid: string | null;
  eventId: string | null;
  sessionDate: string;
  event: calendar_v3.Schema$Event;
  run: ReminderRun | null;
  resolution: TrainerResolutionResult;
  decision: ReminderDecision;
  mappingReason: string;
  acknowledgement: ReturnType<typeof sessionAcknowledgement>;
}
export interface ReminderSnapshotInput {
  events: calendar_v3.Schema$Event[];
  runs: ReminderRun[];
  mappings: EventMapping[];
  directory: TrainerIdentity[];
  queue: QueuedReminder[];
  start: string;
  end: string;
  today: string;
  ignoreNotificationId?: string;
}

export function buildReminderSnapshot(input: ReminderSnapshotInput): ReminderSession[] {
  const matched = matchEventsToRuns(input.events, input.runs, input.mappings, input.start, input.end);
  const entries = [
    ...matched.resolved.map(r => ({ event: r.event, run: input.runs.find(c => c.runUuid === r.runUuid)!, reason: r.tier })),
    ...matched.unresolved.map(r => ({ event: r.event, run: null, reason: r.reason })),
  ];
  return entries.map(({ event, run, reason }) => {
    const sessionDate = eventDateIso(event);
    const resolution = resolveEventTrainers(event, input.directory);
    let assignmentAmbiguous = false;
    const sessions = run?.sessions.filter(s => s.date === sessionDate) || [];
    const needsDefaults = !sessions.length || sessions.some(s => !s.trainer_id);
    const defaults = (needsDefaults ? run?.assignments || [] : []).flatMap(a => {
      const emailMatches = a.email ? matchGuestIdentity({ email: a.email }, input.directory) : [];
      const matches = a.user_id ? input.directory.filter(t => t.user_id === a.user_id) : emailMatches;
      if (matches.length !== 1 || !matches[0].active || emailMatches.some(t => t.user_id !== matches[0]?.user_id)) {
        assignmentAmbiguous = true;
        return [];
      }
      return [matches[0].user_id];
    });
    const ids = sessions.length ? sessions.flatMap(s => s.trainer_id ? [s.trainer_id] : defaults) : defaults;
    const assignedTrainerIds = [...new Set(ids)];
    if (assignedTrainerIds.some(id => !input.directory.some(t => t.user_id === id && t.active))) assignmentAmbiguous = true;
    const decision = evaluateReminderEligibility({
      runUuid: run?.runUuid || null, eventId: event.id || null, sessionDate,
      classStatus: run?.classStatus || null, resolution, assignedTrainerIds, assignmentAmbiguous,
      queue: input.queue, today: input.today, ignoreNotificationId: input.ignoreNotificationId, linkageReason: reason,
    });
    return {
      runUuid: run?.runUuid || null, eventId: event.id || null, sessionDate, event, run, resolution, decision, mappingReason: reason,
      acknowledgement: run && event.id ? sessionAcknowledgement(run.runUuid, event.id, sessionDate, resolution) : null,
    };
  }).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || (a.eventId || '').localeCompare(b.eventId || ''));
}

function publicTrainer(trainer: TrainerIdentity | null) {
  return trainer ? { trainer_id: trainer.user_id, name: trainer.name, email: trainer.email, phone_e164: normalizeSgPhone(trainer.phone) } : null;
}
export function reminderSessionToApi(row: ReminderSession, fetchedAt: string, calendarId: string, baseUrl: string) {
  const d = row.run?.details || {};
  const duration = Number(d.session_days || d.num_of_days || 0);
  const venue = [d.venue_building, d.venue_block, d.venue_street, d.venue_floor, d.venue_unit, d.venue_room, d.venue_postal_code].filter(Boolean).join(', ') || null;
  return {
    course_run_id: row.run?.courseRunId || null,
    course_code: row.run?.courseCode || extractEventCourseCode(row.event) || null,
    course_title: row.event.summary || row.run?.courseTitle || null,
    lms_course_title: row.run?.courseTitle || null,
    session_date: row.sessionDate,
    // Compatibility alias for report consumers which previously displayed the run's start as the session.
    start_date: row.sessionDate,
    end_date: row.run?.endDate || null,
    run_start_date: row.run?.startDate || null,
    run_end_date: row.run?.endDate || null,
    calendar_event_id: row.eventId,
    calendar_event_url: row.event.htmlLink || null,
    calendar_id: calendarId,
    source_fetched_at: fetchedAt,
    mapping_status: row.run ? 'verified' : 'unresolved',
    mapping_reason: row.mappingReason,
    trainer: publicTrainer(row.resolution.trainer),
    trainer_resolution: { source: row.resolution.source, candidates: row.resolution.candidates.map(publicTrainer) },
    reminder_recipient: publicTrainer(row.decision.recipient),
    send_reminder: row.decision.eligible,
    reminder_eligibility: { eligible: row.decision.eligible, reason: row.decision.reason },
    acknowledgement: row.acknowledgement,
    lms_trainers: row.run?.assignments || [],
    tpg_trainer: d.tpg_assigned_trainer_name ? { name: d.tpg_assigned_trainer_name, email: d.tpg_assigned_trainer_email } : null,
    status: row.run?.classStatus || null,
    learner_count: d.learner_count ?? null,
    duration_label: duration > 0 ? `${duration} day${duration === 1 ? '' : 's'}` : 'N/A',
    mode_of_training: row.run?.modeOfLearning || null,
    is_virtual: row.run?.modeOfLearning === 'Virtual',
    is_external: row.run?.modeOfLearning === 'External',
    venue,
    google_meet_url: row.event.hangoutLink || d.virtual_meeting_link || null,
    lms_login_url: `${baseUrl.replace(/\/$/, '')}/`,
    e_attendance_url: d.digital_attendance_id ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${d.digital_attendance_id}` : null,
    attendance_code: d.digital_attendance_id || null,
    admin_warning: row.resolution.adminWarning || (!row.run ? row.mappingReason : null),
    remarks: null,
    last_reminder_sent_at: null,
    reminder_sent_count: null,
  };
}
