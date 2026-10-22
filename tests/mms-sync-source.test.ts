import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { CalendarClient } from '../lib/calendar/calendarClient';
import { buildSnapshot, resolveEvent, calendarIdentity, type SourceRecord } from '../lib/mmsSync/source';
const event = { id: 'event-1', summary: 'Pilot', description: 'Course Code: C916', start: { dateTime: '2026-11-10T09:30:00+08:00' }, end: { dateTime: '2026-11-10T17:30:00+08:00' } };
const source: SourceRecord = { source_run_key: calendarIdentity('sales@tertiarycourses.com.sg', 'event-1'), course_code: 'C916', calendar_id: 'sales@tertiarycourses.com.sg', event_ids: ['event-1'], tms_run_uuid: null, masterlist_class_id: 'class-1' };
const readClient = { calendarId: source.calendar_id, calendar: { events: { get: async () => ({ data: event }) } } } as unknown as CalendarClient;
test('a later-day Calendar event cannot masquerade as the full first session', async () => {
    for (const summary of ['DP600 Day 3', 'Pilot Session 2', 'Pilot Part 10']) {
        const client = { calendarId: source.calendar_id, calendar: { events: { get: async () => ({ data: { ...event, summary } }) } } } as unknown as CalendarClient;
        await assert.rejects(() => buildSnapshot(database([{ email: 'learner@example.com', name: 'Learner' }]), source, client), /later course day/);
    }
});
function database(master: Record<string, unknown>[], users: Record<string, unknown>[] = []): Pool {
    return { query: async (sql: string) => {
            if (sql.includes('FROM course c WHERE'))
                return { rows: [] };
            if (sql.includes('FROM masterlist_table'))
                return { rows: master };
            if (sql.includes('FROM app_user'))
                return { rows: users };
            throw new Error(`Unexpected database read: ${sql}`);
        } } as unknown as Pool;
}
test('calendar-only class uses saved TMS roster rather than arbitrary event attendees', async () => {
    const db = database([{ email: 'learner@example.com', name: 'Learner', trainer_email: '', cancelled: false }], []);
    const result = await buildSnapshot(db, source, readClient);
    assert.equal(result.roster_complete, true);
    assert.equal(result.learners.length, 1);
    assert.equal(result.learners[0].email, 'learner@example.com');
    assert.equal(result.sessions[0].date, '2026-11-10');
});
test('missing operational roster and deleted saved Master List do not become empty authoritative rosters', async () => {
    await assert.rejects(() => buildSnapshot(database([]), source, readClient), /Master List is missing/);
    await assert.rejects(() => buildSnapshot(database([]), { ...source, masterlist_class_id: null }, readClient), /incomplete roster/);
});
test('a saved Calendar trainer stays unconfirmed until operations explicitly approves the assignment', async () => {
    const db = database([{ email: '', name: '', trainer_email: 'trainer@example.com', trainer: 'Trainer', cancelled: false }], [{ id: 'trainer-id', full_name: 'Trainer', email: 'trainer@example.com', account_status: 'Active' }]);
    const pending = await buildSnapshot(db, source, readClient);
    assert.equal(pending.trainers[0].confirmed, false);
    const confirmed = await buildSnapshot(db, { ...source, trainer_approved_email: 'trainer@example.com' }, readClient);
    assert.equal(confirmed.trainers[0].confirmed, true);
});
test('source schedule changes are checked against Calendar before import', async () => {
    const db = database([{ email: '', name: '', trainer_email: '', schedule_entries: [{ id: 'session-1', startTime: '10:00', endTime: '17:30' }] }]);
    await assert.rejects(() => buildSnapshot(db, source, readClient), /conflict with Calendar/);
});
test('a funded code is excluded before any source/database resolution', async () => {
    const db = { query: async () => { throw new Error('Funded event reached a database resolver.'); } } as unknown as Pool;
    assert.equal(await resolveEvent(db, source.calendar_id, { ...event, description: 'Course Code: TGS-123' }), null);
    await assert.rejects(() => buildSnapshot(db, { ...source, course_code: ' tgs-123 ' }, readClient), /Funded TGS/);
});
test('confirmed direct/company applications use exact run and code when no TMS course_run exists', async () => {
    const db = { query: async (sql: string, params: unknown[]) => {
            if (sql.includes('FROM course c WHERE'))
                return { rows: [] };
            if (sql.includes('FROM da_application')) {
                assert.deepEqual(params, ['operational-916', 'C916']);
                return { rows: [{ a: { trainee_email: 'direct@example.com', trainee_name: 'Direct learner', application_status: 'Confirm application', enrolment_status: 'Registered' } }] };
            }
            if (sql.includes('FROM company_application'))
                return { rows: [{ a: { trainee_email: 'withdrawn@example.com', application_status: 'Cancelled' } }] };
            if (sql.includes('FROM app_user'))
                return { rows: [] };
            throw new Error(`Unexpected read ${sql}`);
        } } as unknown as Pool;
    const result = await buildSnapshot(db, { ...source, masterlist_class_id: null, operational_run_id: 'operational-916' }, readClient);
    assert.equal(result.roster_complete, true);
    assert.equal(result.learners.length, 1);
    assert.equal(result.learners[0].email, 'direct@example.com');
});
test('inactive learner and removed trainer role are exported as ineligible class participants', async () => {
    const db = database([{ email: 'person@example.com', name: 'Person', trainer_email: 'person@example.com', trainer: 'Person' }], [{ id: 'person-id', email: 'person@example.com', full_name: 'Person', account_status: 'Inactive', is_trainer: false }]);
    const result = await buildSnapshot(db, { ...source, trainer_approved_email: 'person@example.com' }, readClient);
    assert.equal(result.learners[0].active, false);
    assert.equal(result.trainers[0].active, false);
});
test('linked profile identity carries current name, phone and changed email despite saved roster text', async () => {
    const original = await buildSnapshot(database([{ email: 'person@example.com', name: 'Old Name', trainer_email: 'person@example.com', trainer: 'Old Name' }], [{ id: 'person-id', email: 'person@example.com', full_name: 'Original Name', account_status: 'Active', is_trainer: true }]), { ...source, trainer_approved_email: 'person@example.com' }, readClient);
    const db = database([{ email: 'person@example.com', name: 'Old Name', trainer_email: 'person@example.com', trainer: 'Old Name' }], [{ id: 'person-id', email: 'updated@example.com', full_name: 'Updated Name', tel: '87654321', account_status: 'Active', is_trainer: true }]);
    const updated = await buildSnapshot(db, { ...source, trainer_approved_email: 'person@example.com', snapshot: original }, readClient);
    assert.equal(updated.learners[0].source_id, 'person-id');
    assert.equal(updated.learners[0].email, 'updated@example.com');
    assert.equal(updated.learners[0].name, 'Updated Name');
    assert.equal(updated.learners[0].phone, '87654321');
    assert.equal(updated.trainers[0].email, 'updated@example.com');
    assert.equal(updated.trainers[0].confirmed, true);
    const repeated = await buildSnapshot(db, { ...source, trainer_approved_email: 'person@example.com', snapshot: updated, person_aliases: { 'person@example.com': 'person-id', 'updated@example.com': 'person-id' } }, readClient);
    assert.equal(repeated.learners[0].source_id, 'person-id');
    assert.equal(repeated.trainers[0].email, 'updated@example.com');
});
