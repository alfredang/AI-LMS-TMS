import assert from 'node:assert/strict';
import test from 'node:test';
import type { calendar_v3 } from 'googleapis';
import { resolveEventTrainers, type TrainerIdentity } from '../lib/calendar/trainerIdentityRules';
import { acknowledgementKey, sessionAcknowledgement } from '../lib/calendar/trainerAcknowledgementRules';
import { matchEventsToRuns } from '../lib/calendar/eventRunRules';
import { buildReminderSnapshot, reminderSessionToApi, type ReminderRun, type ReminderSnapshotInput } from '../lib/calendar/trainerReminderSnapshot';
import { queuedReminderMatches, sgtDate, isIsoDate, type QueuedReminder } from '../lib/calendar/reminderEligibilityRules';
import { eventDateIso, extractEventCourseCode } from '../lib/calendar/eventMatch';

const date = '2026-09-26';
const trainer: TrainerIdentity = { user_id: 'trainer-a', name: 'Trainer A', email: 'a@example.com', emails: ['a@example.com', 'alias@example.com'], phone: '91234567', active: true };
const other: TrainerIdentity = { ...trainer, user_id: 'trainer-b', name: 'Trainer B', email: 'b@example.com', emails: ['b@example.com'] };
const guest = (responseStatus: string, email = trainer.email): calendar_v3.Schema$EventAttendee => ({ email, responseStatus });
const event = (overrides: calendar_v3.Schema$Event = {}): calendar_v3.Schema$Event => ({ id: 'event-a', summary: 'Agentic AI Automation with n8n', description: 'Course Run ID: 1414373\nCourse Code: TGS-2023035977', start: { date }, attendees: [guest('needsAction')], ...overrides });
const run: ReminderRun = { runUuid: 'run-a', courseRunId: '1414373', courseCode: 'TGS-2023035977', courseTitle: 'Agentic AI Automation with n8n', startDate: '2026-09-20', endDate: '2026-09-27', sessionDates: ['2026-09-20', date, '2026-09-27'], modeOfLearning: 'Physical', classStatus: 'Confirmed', assignments: [{ user_id: trainer.user_id, email: trainer.email, name: trainer.name }], sessions: [{ date, trainer_id: null }], details: {} };
const input = (overrides: Partial<ReminderSnapshotInput> = {}): ReminderSnapshotInput => ({ events: [event()], runs: [run], mappings: [], directory: [trainer, other], queue: [], start: date, end: date, today: '2026-09-23', ...overrides });
const queued: QueuedReminder = { id: 'queue-a', runUuid: 'run-a', sessionDate: date, eventId: 'event-a', trainerUserId: trainer.user_id, trainerEmail: trainer.email, trainerPhone: '+6591234567', status: 'pending', runStartDate: '2026-09-20' };

test('acceptance requires an individual active trainer guest, including recorded alternate email', () => {
  const resolved = resolveEventTrainers(event({ attendees: [guest('accepted', ' ALIAS@example.com '), guest('needsAction', other.email)] }), [trainer, other]);
  assert.equal(resolved.source, 'gcal_accepted');
  assert.equal(resolved.trainer?.user_id, trainer.user_id);
  assert.deepEqual(resolved.pending.map(t => t.user_id), [other.user_id]);
});
test('organizer, calendar self, resources, declined trainers and accepted learners do not count', () => {
  const attendees = [
    { ...guest('accepted'), organizer: true }, { ...guest('accepted'), self: true }, { ...guest('accepted'), resource: true },
    guest('declined'), guest('accepted', 'learner@example.com'),
  ];
  assert.equal(resolveEventTrainers(event({ attendees }), [trainer]).trainer, null);
  assert.equal(resolveEventTrainers(event({ attendees: [guest('accepted')], organizer: { email: trainer.email } }), [trainer]).trainer, null);
});
test('duplicate emails, inactive identities and multiple accepted trainers are held', () => {
  for (const directory of [[trainer, { ...other, emails: trainer.emails }], [{ ...trainer, active: false }]]) {
    assert.equal(resolveEventTrainers(event({ attendees: [guest('accepted')] }), directory).source, 'ambiguous');
  }
  assert.equal(resolveEventTrainers(event({ attendees: [guest('accepted'), guest('accepted', other.email)] }), [trainer, other]).source, 'ambiguous');
});
test('exact unique name fallback is allowed only when email is absent', () => {
  assert.equal(resolveEventTrainers(event({ attendees: [{ displayName: ' Trainer  A ', responseStatus: 'accepted' }] }), [trainer]).trainer?.user_id, trainer.user_id);
  assert.equal(resolveEventTrainers(event({ attendees: [{ displayName: trainer.name, email: 'wrong@example.com', responseStatus: 'accepted' }] }), [trainer]).trainer, null);
  assert.equal(resolveEventTrainers(event({ attendees: [{ displayName: trainer.name, responseStatus: 'accepted' }] }), [trainer, { ...other, name: trainer.name }]).source, 'ambiguous');
});
test('incomplete guest lists and cancelled events cannot establish acceptance', () => {
  for (const overrides of [{ attendeesOmitted: true }, { status: 'cancelled' }]) assert.equal(resolveEventTrainers(event(overrides), [trainer]).source, 'calendar_unavailable');
});
test('acknowledgements are scoped to event, operational run, session date and person', () => {
  const resolution = resolveEventTrainers(event({ attendees: [guest('accepted')] }), [trainer]);
  const acknowledgement = sessionAcknowledgement('run-a', 'event-a', date, resolution)!;
  for (const args of [['run-b', 'event-a', date, trainer.user_id], ['run-a', 'event-b', date, trainer.user_id], ['run-a', 'event-a', '2026-09-27', trainer.user_id], ['run-a', 'event-a', date, other.user_id]]) {
    assert.notEqual(acknowledgement.key, acknowledgementKey(args[0], args[1], args[2], args[3]));
  }
  assert.equal(sessionAcknowledgement('run-a', 'event-a', date, resolveEventTrainers(event(), [trainer])), null);
});
test('n8n report uses September 26 session, preserving September 20 run start separately', () => {
  const row = buildReminderSnapshot(input())[0];
  const api = reminderSessionToApi(row, 'now', 'calendar', 'https://example.com');
  assert.equal(row.decision.eligible, true);
  assert.equal(api.session_date, date); assert.equal(api.start_date, date); assert.equal(api.run_start_date, '2026-09-20');
  assert.equal(api.trainer, null); assert.equal(api.reminder_recipient?.trainer_id, trainer.user_id);
});
test('Singapore date boundaries and lead times do not depend on server timezone', () => {
  assert.equal(eventDateIso(event({ start: { dateTime: '2026-09-25T17:00:00Z' } })), date);
  assert.equal(sgtDate(new Date('2026-09-22T16:30:00Z'), 3), date);
  assert.equal(isIsoDate('2026-02-30'), false); assert.equal(isIsoDate('2026-09-26'), true);
});
test('HTML course metadata is read without fuzzy title matching', () => {
  assert.equal(extractEventCourseCode(event({ description: '<b>TGS-2023035977</b>' })), run.courseCode);
  const matched = matchEventsToRuns([event({ description: '' })], [run], [], date, date);
  assert.equal(matched.resolved.length, 0);
});
test('explicit missing or conflicting run identifiers never fall through', () => {
  for (const description of ['Course Run ID: 999\nCourse Code: TGS-2023035977', 'Course Run ID: 1414373\nCourse Code: TGS-OTHER']) {
    assert.equal(matchEventsToRuns([event({ description })], [run], [], date, date).resolved.length, 0);
  }
  assert.equal(matchEventsToRuns([event()], [run], [{ google_event_id: 'event-a', course_run_id: 'run-a', event_date: '2026-09-20' }], date, date).resolved.length, 0);
});
test('code matching requires unique operational session and delivery mode', () => {
  const e = event({ description: 'TGS-2023035977', location: 'Woods Square' });
  assert.equal(matchEventsToRuns([e], [run], [], date, date).resolved.length, 1);
  for (const runs of [[{ ...run, sessionDates: [] }], [run, { ...run, runUuid: 'duplicate', courseRunId: 'other' }], [{ ...run, modeOfLearning: 'Virtual' }]]) {
    assert.equal(matchEventsToRuns([e], runs, [], date, date).resolved.length, 0);
  }
  assert.equal(matchEventsToRuns([event({ description: 'TGS-2023035977' })], [run], [], date, date).resolved.length, 0);
});
test('distinct duplicate events hold both records; repeated copies of same ID do not duplicate rows', () => {
  assert.equal(matchEventsToRuns([event(), event()], [run], [], date, date).resolved.length, 1);
  const result = matchEventsToRuns([event(), event({ id: 'duplicate' })], [run], [], date, date);
  assert.equal(result.resolved.length, 0); assert.equal(result.unresolved.length, 2);
});
test('one accepted run does not suppress another run with same TGS/date', () => {
  const rows = buildReminderSnapshot(input({ runs: [run, { ...run, runUuid: 'run-b', courseRunId: '222' }], events: [event({ attendees: [guest('accepted')] }), event({ id: 'event-b', description: 'Course Run ID: 222' })] }));
  assert.equal(rows.find(r => r.runUuid === 'run-a')?.decision.reason, 'trainer_accepted_this_session');
  assert.equal(rows.find(r => r.runUuid === 'run-b')?.decision.eligible, true);
});
test('status, session override, unknown identity, past dates and declined RSVP gate every consumer', () => {
  const cases: Array<[Partial<ReminderSnapshotInput>, string]> = [
    [{ runs: [{ ...run, classStatus: 'Cancelled' }] }, 'class_not_confirmed'],
    [{ today: date }, 'session_not_in_future'],
    [{ events: [event({ attendees: [guest('declined')] })] }, 'no_verified_pending_trainer'],
    [{ runs: [{ ...run, sessions: [{ date, trainer_id: other.user_id }] }] }, 'local_assignment_differs'],
    [{ directory: [{ ...trainer, phone: '123' }] }, 'no_usable_phone'],
    [{ events: [event({ attendees: [guest('needsAction'), guest('tentative', other.email)] })] }, 'multiple_pending_trainers'],
  ];
  for (const [overrides, expected] of cases) assert.equal(buildReminderSnapshot(input(overrides))[0].decision.reason, expected);
});
test('report, queue and dispatch agree, while dispatch excludes its own queued record', () => {
  assert.equal(buildReminderSnapshot(input())[0].decision.eligible, true);
  assert.equal(buildReminderSnapshot(input({ queue: [queued] }))[0].decision.reason, 'already_queued');
  const dispatchRow = buildReminderSnapshot(input({ queue: [queued], ignoreNotificationId: queued.id }))[0];
  assert.equal(queuedReminderMatches(queued, dispatchRow), true);
  for (const changes of [{ sessionDate: null }, { eventId: null }, { trainerUserId: null }, { eventId: 'different' }, { trainerPhone: '+6599999999' }, { trainerEmail: 'wrong@example.com' }]) {
    assert.equal(queuedReminderMatches({ ...queued, ...changes }, dispatchRow), false);
  }
});
test('fresh acceptance after queueing prevents release', () => {
  const row = buildReminderSnapshot(input({ events: [event({ attendees: [guest('accepted')] })], queue: [queued], ignoreNotificationId: queued.id }))[0];
  assert.equal(queuedReminderMatches(queued, row), false);
});
test('deduplication is exact session/person and includes aliases and legacy run-start records', () => {
  for (const status of ['pending', 'dispatched', 'sent', 'failed', 'expired', 'cancelled', 'no_phone']) assert.equal(buildReminderSnapshot(input({ queue: [{ ...queued, status }] }))[0].decision.eligible, false);
  assert.equal(buildReminderSnapshot(input({ queue: [{ ...queued, sessionDate: '2026-09-20' }] }))[0].decision.eligible, true);
  assert.equal(buildReminderSnapshot(input({ queue: [{ ...queued, sessionDate: null, trainerUserId: null, trainerEmail: 'alias@example.com', runStartDate: date }] }))[0].decision.eligible, false);
});
