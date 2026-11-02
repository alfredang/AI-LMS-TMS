import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { buildSnapshot, type SourceRecord } from '../lib/mmsSync/source';
import { masterListDates, masterListSources } from '../lib/mmsSync/masterList';
import { automaticSyncUntil } from '../lib/mmsSync/syncWindow';
import { operationalApproval } from '../lib/mmsSync/operationPolicy';

const source: SourceRecord = { source_run_key: 'masterlist:class-1', course_code: 'C916', calendar_id: 'masterlist', event_ids: [], tms_run_uuid: null, masterlist_class_id: 'class-1' };
function database(master: Record<string, unknown>[], known: unknown[] = []): Pool {
    return { query: async (sql: string) => {
        if (sql.includes('FROM course c WHERE')) return { rows: [] };
        if (sql.includes('FROM masterlist_table')) return { rows: master };
        if (sql.includes('FROM app_user')) return { rows: [] };
        if (sql.includes('SELECT * FROM mms_sync_source')) return { rows: known };
        if (sql.includes('SELECT id,course_code,title FROM course')) return { rows: [{ id: 'c', course_code: 'C916', title: 'Pilot' }] };
        if (sql.includes('FROM course_run cr JOIN course')) return { rows: [] };
        if (sql.startsWith('UPDATE masterlist_table')) return { rows: [] };
        throw new Error(`Unexpected database read: ${sql}`);
    } } as unknown as Pool;
}
test('empty pending Master List class synchronizes without Calendar, schedule or assignments', async () => {
    const snapshot = await buildSnapshot(database([{ class_id: 'class-1', course_title: 'Pilot', course_code: 'C916', list_date: '2099-11-10' }]), source);
    assert.equal(snapshot.schema_version, 2);
    assert.deepEqual(snapshot.sessions, []);
    assert.deepEqual(snapshot.learners, []);
    assert.deepEqual(snapshot.trainers, []);
    assert.equal(snapshot.class_start_date, '2099-11-10');
    assert.doesNotThrow(() => operationalApproval(snapshot, source));
    const undated = await buildSnapshot(database([{ course_title: 'Pilot' }]), source);
    assert.equal(undated.class_start_date, null);
    assert.equal(operationalApproval(undated, source).first_session_at, null);
});
test('Master List is mandatory even if a Calendar event or course_run exists', async () => {
    await assert.rejects(() => buildSnapshot(database([]), { ...source, masterlist_class_id: null, tms_run_uuid: 'run-id', event_ids: ['calendar-only'] }), /Only saved Master List/);
    await assert.rejects(() => buildSnapshot(database([]), source), /no longer exists/);
});
test('missing/invalid learner details are retained without blocking valid learners or the class', async () => {
    const snapshot = await buildSnapshot(database([{ course_code: 'C916', course_title: 'LMS title', name: 'Pending', email: '', id: 'p' }, { name: 'Valid', email: 'VALID@example.com' }, { name: 'Buyer', email: 'buyer@example.com' }]), source);
    assert.equal(snapshot.roster_complete, false);
    assert.equal(snapshot.pending_learners?.[0].name, 'Pending');
    assert.equal(snapshot.learners.length, 2);
    assert.equal(snapshot.course_title, 'LMS title');
});
test('saved trainer is authoritative and clearing the assignment exports an empty trainer list', async () => {
    const assigned = await buildSnapshot(database([{ course_title: 'Pilot', trainer: 'Assigned', trainer_email: 'trainer@example.com' }]), source);
    assert.equal(assigned.trainers[0].confirmed, true);
    assert.equal(assigned.trainers[0].email, 'trainer@example.com');
    const cleared = await buildSnapshot(database([{ course_title: 'Pilot', trainer: '', trainer_email: '' }]), { ...source, snapshot: assigned });
    assert.deepEqual(cleared.trainers, []);
});
test('discovery reads saved C classes only, consolidates identical code/date ranges, excludes ended/funded classes', async () => {
    const db = database([
        { id: '1', class_id: 'a', course_code: 'C916', course_title: 'First title', class_date: '2020-10-20~2099-11-10' },
        { id: '2', class_id: 'b', course_code: 'C916', course_title: 'Different title', class_date: '2020-10-20~2099-11-10' },
        { id: '3', class_id: 'c', course_code: 'TGS-123', list_date: '2099-11-10' },
        { id: '4', class_id: 'd', course_code: 'C916', list_date: '2020-11-10' },
        { id: '5', class_id: 'e', course_code: 'C916' },
    ]);
    const sources = await masterListSources(db);
    assert.equal(sources.length, 2);
    assert.deepEqual(sources[0].masterlist_class_ids, ['a', 'b']);
    assert.equal(sources[1].masterlist_class_id, 'e');
});
test('ongoing pre-pilot classes remain eligible until their final Singapore date, with no three-hour cutoff', async () => {
    const snapshot = await buildSnapshot(database([{ course_title: 'Pilot', class_date: '2020-01-01~2099-11-10' }]), source);
    assert.doesNotThrow(() => operationalApproval(snapshot, source));
    assert.equal(automaticSyncUntil(snapshot), '2099-11-10T15:59:59.999Z');
});
test('date parsing follows Singapore dates and session keys survive time corrections', async () => {
    assert.deepEqual(masterListDates({ class_date: '10/11/2099 - 11/11/2099' }), ['2099-11-10', '2099-11-11']);
    const row = { class_id: 'class-1', course_title: 'Pilot', list_date: '2099-11-10', schedule_entries: [{ id: 'session', startTime: '09:30', endTime: '17:30' }] };
    const a = await buildSnapshot(database([row]), source);
    const b = await buildSnapshot(database([{ ...row, schedule_entries: [{ ...row.schedule_entries[0], startTime: '10:00' }] }]), source);
    assert.equal(a.sessions[0].key, b.sessions[0].key);
});
test('funded courses are rejected before database reads', async () => {
    const db = { query: async () => { throw new Error('Database must not be read'); } } as unknown as Pool;
    await assert.rejects(() => buildSnapshot(db, { ...source, course_code: ' tgs-123 ' }), /Funded TGS/);
});
test('linked LMS assignments and session overrides synchronize without a conflict gate', async () => {
    const db = database([{ course_title: 'Pilot', trainer: 'Stale header', trainer_email: 'stale@example.com', list_date: '2099-11-10' }]);
    const base = db.query.bind(db);
    (db as any).query = async (sql: string, args: unknown[]) => {
        if (sql.startsWith('SELECT to_jsonb(cr) run')) return { rows: [{ run: { assigned_trainer_email: 'main@example.com', assigned_trainer_name: 'Main' } }] };
        if (sql.includes('FROM enrollment')) return { rows: [{ id: 'enrolled', email: 'enrolled@example.com', full_name: 'Enrolled' }] };
        if (sql.includes('FROM course_run_trainer')) return { rows: [] };
        if (sql.includes('FROM course_session')) return { rows: [{ s: { id: 'override', start_date: '20991110', start_time: '09:30', end_time: '17:30', trainer_email: 'session@example.com', trainer_name: 'Session' } }] };
        return base(sql, args);
    };
    const snapshot = await buildSnapshot(db, { ...source, tms_run_uuid: 'run' });
    assert.deepEqual(snapshot.trainers.map(p => p.email).sort(), ['main@example.com','session@example.com']);
    assert.equal(snapshot.learners[0].email, 'enrolled@example.com');
    assert.equal(snapshot.sessions.length, 1);
});
