import test from 'node:test';
import assert from 'node:assert/strict';
import { accessContext, accessMessage, assertRunApproval, firstSessionAt, participantUrls, recipients, withApproval } from '../lib/mmsSync/accessPolicy';
import { snapshotHash, type RunSnapshot } from '../lib/mmsSync/contract';

const fixture = (): RunSnapshot => ({ schema_version: 1, source_provider_id: 'test', source_run_key: 'calendar:pilot', website_id: 1, course_code: 'C916', course_title: 'Pilot <class>', calendar_id: 'test@example.com', event_occurrences: ['event'], revision: 1, request_id: 'test', snapshot_hash: '', snapshot_at: '2026-10-21T00:00:00Z', roster_complete: true, cancelled: false,
    sessions: [{ key: 's1234567', source_id: 'session', date: '2050-10-23', start_time: '09:30', end_time: '17:30', venue: 'Room', virtual_link: 'https://meet.example.com/pilot', mode: 2 }],
    trainers: [{ source_id: 'trainer', email: 'trainer@example.com', name: 'Trainer', confirmed: true }], learners: [{ source_id: 'learner', email: 'learner@example.com', name: 'Learner' }], courseware: {}, feedback_url: 'https://tms.example.com/feedback/test' });
const approval = () => ({ approved_at: '2026-10-21T00:00:00Z', approved_by: 'operator', first_session_at: '2050-10-23T01:30:00.000Z', handover_at: '2026-10-21T01:00:00Z' });
const source = () => {
    const snapshot = withApproval(fixture(), approval());
    snapshot.snapshot_hash = snapshotHash(snapshot);
    return { ...approval(), last_success_at: new Date().toISOString(), course_code: snapshot.course_code, source_run_key: snapshot.source_run_key, revision: snapshot.revision, snapshot, snapshot_hash: snapshot.snapshot_hash, target_result: { readiness: 'ready', revision: 1, snapshot_hash: snapshot.snapshot_hash, class_id: 'C000001', run_id: 42, participant_login_url: 'https://mms.example.com/lmslogin/', participant_class_url: 'https://mms.example.com/lmslogin/index/class/?run_id=42' } };
};
test('funded routing is unchanged even with a hostile existing MMS mapping', () => {
    for (const code of ['TGS123', ' tgs-123 ', 'TgS-2026']) assert.deepEqual(accessContext(code, source(), false, 'https://evil.example'), { platform: 'tms', state: 'legacy' });
});
test('run approval uses the full first session, SGT, pilot date and initial handover time', () => {
    const snapshot = fixture();
    assert.equal(firstSessionAt(snapshot), '2050-10-23T01:30:00.000Z');
    assert.doesNotThrow(() => assertRunApproval(approval(), snapshot, new Date('2050-10-24')));
    assert.throws(() => assertRunApproval({ ...approval(), handover_at: null }, snapshot, new Date('2050-10-24')), /before/);
    assert.throws(() => assertRunApproval({ ...approval(), first_session_at: '2050-10-24T01:30:00Z' }, snapshot), /changed/);
    assert.throws(() => assertRunApproval({}, snapshot), /Approve/);
    const underway = fixture(); underway.sessions[0].date = '2026-10-22';
    assert.throws(() => assertRunApproval({ ...approval(), first_session_at: firstSessionAt(underway) }, underway), /outside/);
});
test('only an approved ready current exact run has MMS access', () => {
    assert.equal(accessContext('C916', null, false).platform, 'tms');
    assert.equal(accessContext('C916', { ...source(), delivery_platform: 'tms' }, false).platform, 'tms');
    assert.equal(accessContext('C916', source(), false, 'https://mms.example.com').state, 'ready');
    for (const changed of [{ last_error: 'failure' }, { last_success_at: '2026-10-20T00:00:00Z' }, { target_result: { ...source().target_result, revision: 0 } }, { target_result: { ...source().target_result, readiness: 'incomplete' } }, { snapshot: { ...source().snapshot, cancelled: true } }, { handover_at: null }, { snapshot_hash: 'stale' }]) {
        const context = accessContext('C916', { ...source(), ...changed }, false, 'https://mms.example.com');
        assert.equal(context.platform, 'mms'); assert.equal(context.state, 'pending'); assert.equal(context.class_url, undefined);
    }
    assert.equal(accessContext('C916', source(), true, 'https://mms.example.com').state, 'pending');
});
test('participant URLs allow only the configured origin and exact run entry', () => {
    const result = source().target_result;
    assert.equal(participantUrls(result, 'https://mms.example.com').class_url, result.participant_class_url);
    for (const url of ['https://evil.example/lmslogin/index/class/?run_id=42', 'https://mms.example.com/tigerdragon/dashboard/?run=42', 'https://mms.example.com/lmslogin/index/class/?run_id=43', 'https://mms.example.com/lmslogin/index/class/?run_id=42&email=learner@example.com', 'https://u:p@mms.example.com/lmslogin/index/class/?run_id=42'])
        assert.throws(() => participantUrls({ ...result, participant_class_url: url }, 'https://mms.example.com'));
    assert.throws(() => participantUrls(result, 'http://mms.example.com'));
    assert.throws(() => participantUrls(result, 'https://mms.example.com/not-a-root'));
});
test('only active confirmed participants are notified, independently for each role', () => {
    const snapshot = fixture();
    snapshot.trainers.push({ source_id: 'pending', email: 'pending@example.com', name: 'Pending', confirmed: false });
    snapshot.learners.push({ source_id: 'blocked', email: 'blocked@example.com', name: 'Blocked', active: false });
    snapshot.learners.push({ ...snapshot.trainers[0] });
    assert.deepEqual(recipients(snapshot).map(p => `${p.source_id}:${p.role}`), ['trainer:trainer', 'learner:learner', 'trainer:learner']);
    assert.deepEqual(recipients({ ...snapshot, cancelled: true }), []);
    assert.deepEqual(recipients({ ...snapshot, roster_complete: false }), []);
});
test('access email contains class/login/session/help and no old credentials or funded attendance', () => {
    const context = accessContext('C916', source(), false, 'https://mms.example.com');
    for (const role of ['trainer', 'learner'] as const) {
        const message = accessMessage(context, { name: '<script>', role }, 'support@example.com');
        assert.match(message.text, /run_id=42/); assert.match(message.text, /SGT/); assert.match(message.text, /OTP/);
        assert.match(message.text, /support@example.com/); assert.match(message.text, /TMS password is not automatically/);
        assert.doesNotMatch(message.text, /myskillsfuture|lms-tms\.tertiaryinfotech/);
        assert.match(message.html, /&lt;script&gt;/); assert.doesNotMatch(message.html, /<script>/);
    }
    assert.throws(() => accessMessage({ platform: 'mms', state: 'pending' }, { name: 'A', role: 'learner' }, 'support'), /not ready/);
});
