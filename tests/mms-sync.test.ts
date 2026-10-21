import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNonFunded, dateInSingapore, normalizePeople, sessionKey, snapshotHash, validateSnapshot, type RunSnapshot } from '../lib/mmsSync/contract';
const fixture = (): RunSnapshot => ({ schema_version: 1, source_provider_id: 'tertiary-sg', source_run_key: 'calendar:test:event', website_id: 1, course_code: 'C916', course_title: 'Pilot', calendar_id: 'sales@tertiarycourses.com.sg', event_occurrences: ['event'], revision: 1, request_id: 'request', snapshot_hash: '', snapshot_at: '2026-10-21T00:00:00Z', roster_complete: true, cancelled: false, sessions: [{ key: sessionKey('session-1'), source_id: 'session-1', date: '2026-10-22', start_time: '09:30', end_time: '17:30', venue: 'Room 1', virtual_link: '', mode: 1 }], trainers: [], learners: [], feedback_url: '', courseware: {} });
test('funded exclusion is case-insensitive, whitespace-tolerant and requires a code', () => {
    for (const code of ['TGS-2024051900', ' tgs-2024051900 ', 'TGSANY', '', null])
        assert.throws(() => assertNonFunded(code));
    assert.equal(assertNonFunded(' c916 '), 'C916');
    assert.throws(() => assertNonFunded('M916'), /support/);
});
test('missing roster/session evidence cannot pass validation', () => {
    const data = fixture();
    data.roster_complete = false;
    assert.throws(() => validateSnapshot(data), /incomplete/);
    const other = fixture();
    other.sessions[0].date = '2916-10-22';
    assert.throws(() => validateSnapshot(other), /date/);
    const invalid = fixture();
    invalid.sessions[0].date = '2026-02-30';
    assert.throws(() => validateSnapshot(invalid), /date/);
});
test('same email for two distinct people is an exception rather than a duplicate account', () => {
    assert.throws(() => normalizePeople([{ source_id: 'a', email: 'one@example.com', name: 'A' }, { source_id: 'b', email: 'ONE@example.com', name: 'B' }]), /share/);
});
test('session identity survives a reschedule and gaps remain explicit', () => {
    const data = fixture();
    const key = data.sessions[0].key;
    data.sessions[0].date = '2026-10-25';
    data.sessions.push({ ...data.sessions[0], key: sessionKey('second'), source_id: 'second', date: '2026-10-28' });
    assert.equal(validateSnapshot(data).sessions[0].key, key);
    assert.equal(data.sessions.length, 2);
});
test('retries have one content hash while changed rosters and cancelled state get a new hash', () => {
    const first = fixture();
    const hash = snapshotHash(first);
    const retry = { ...first, revision: 12, request_id: 'retry', snapshot_at: new Date().toISOString() };
    assert.equal(snapshotHash(retry), hash);
    retry.learners = [{ source_id: 'a', email: 'a@example.com', name: 'A' }];
    assert.notEqual(snapshotHash(retry), hash);
    assert.notEqual(snapshotHash({ ...first, cancelled: true }), hash);
});
test('date conversion uses Singapore calendar dates, not the host timezone', () => {
    assert.equal(dateInSingapore('2026-10-21T16:30:00Z'), '2026-10-22');
    assert.equal(dateInSingapore('2026-10-21'), '2026-10-21');
});
test('multiple confirmed trainers cannot be silently collapsed to the first', () => {
    const data = fixture();
    data.trainers = [{ source_id: 'a', email: 'a@example.com', name: 'A', confirmed: true }, { source_id: 'b', email: 'b@example.com', name: 'B', confirmed: true }];
    assert.throws(() => validateSnapshot(data), /Multiple trainers/);
});
