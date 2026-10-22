import test from 'node:test';
import assert from 'node:assert/strict';
import { courseAllowed, operationalApproval } from '../lib/mmsSync/operationPolicy';
import { assertRunApproval, firstSessionAt } from '../lib/mmsSync/accessPolicy';
import { type RunSnapshot } from '../lib/mmsSync/contract';

const now = new Date('2026-10-22T06:00:00Z');
const fixture = (): RunSnapshot => ({ schema_version: 1, source_provider_id: 'test', source_run_key: 'calendar:test:operations', website_id: 1, course_code: 'C817', course_title: 'Class', calendar_id: 'sales@example.com', event_occurrences: ['event'], revision: 0, request_id: '', snapshot_hash: '', snapshot_at: now.toISOString(), roster_complete: true, cancelled: false,
    sessions: [{ key: 's1234567', source_id: 'event', date: '2026-10-23', start_time: '09:30', end_time: '17:30', venue: 'Room', virtual_link: '', mode: 1 }], learners: [{ source_id: 'learner', email: 'learner@example.com', name: 'Learner' }], trainers: [], courseware: {}, feedback_url: '' });
const source = { masterlist_class_id: 'saved-class' };

test('normal saved assignments authorize an additional handover without changing the TMS roster', () => {
    const data = fixture(); const before = structuredClone(data);
    const approval = operationalApproval(data, source, now);
    assert.equal(approval.approved_by, 'tms-normal-operations');
    assert.equal(approval.first_session_at, firstSessionAt(data));
    assert.deepEqual(data, before);
    assert.doesNotThrow(() => assertRunApproval(approval, data, now));
});

test('learner-only and trainer-only assignments sync, but empty/unpersisted assignments wait', () => {
    const data = fixture();
    assert.doesNotThrow(() => operationalApproval(data, source, now));
    data.learners = []; data.trainers = [{ source_id: 'trainer', email: 'trainer@example.com', name: 'Trainer', confirmed: true }];
    assert.doesNotThrow(() => operationalApproval(data, source, now));
    data.trainers = [];
    assert.throws(() => operationalApproval(data, source, now), /Awaiting/);
    assert.doesNotThrow(() => operationalApproval(data, source, now, false), 'Pre-assignment invitations must still be classified without importing.');
    assert.throws(() => operationalApproval(fixture(), {}, now), /Save the normal/);
});

test('funded, unsupported and explicit TMS fallback runs never auto-enrol', () => {
    for (const code of [' tgs-123 ', 'TGSANY', '', 'M817']) {
        assert.equal(courseAllowed(code, 'C*,TGSANY,M817'), false);
        assert.throws(() => operationalApproval({ ...fixture(), course_code: code }, source, now));
    }
    assert.throws(() => operationalApproval(fixture(), { ...source, delivery_platform: 'tms' }, now), /retained/);
    assert.equal(courseAllowed(' c817 ', ' c* '), true);
    assert.equal(courseAllowed('C916', 'C817'), false);
    assert.equal(courseAllowed('C817', ''), false);
});

test('automatic runs preserve the no-midway gate, including preapproved but not handed-over runs', () => {
    const data = fixture(); const approval = operationalApproval(data, source, now);
    const started = new Date('2026-10-23T02:00:00Z');
    assert.throws(() => operationalApproval(data, source, started), /before/);
    assert.throws(() => operationalApproval(data, { ...source, ...approval }, started), /before/);
    const handed = { ...source, ...approval, handover_at: '2026-10-22T06:01:00Z' };
    assert.deepEqual(operationalApproval(data, handed, started), handed);
    const later = fixture(); later.sessions[0].date = '2026-10-24';
    assert.throws(() => operationalApproval(later, handed, started), /already-started/);
    assert.throws(() => operationalApproval({ ...data, sessions: [{ ...data.sessions[0], date: '2026-10-22' }] }, source, now), /outside/);
});

test('retries retain their approval identity; future reschedules may be recorded by the same normal workflow', () => {
    const data = fixture(); const approval = operationalApproval(data, source, now);
    assert.deepEqual(operationalApproval(data, { ...source, ...approval }, new Date('2026-10-22T07:00:00Z')), { ...source, ...approval });
    data.sessions[0].date = '2026-10-24';
    const moved = operationalApproval(data, { ...source, ...approval }, new Date('2026-10-22T07:00:00Z'));
    assert.equal(moved.first_session_at, firstSessionAt(data));
    assert.equal(moved.approved_by, 'tms-normal-operations');
});
