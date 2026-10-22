/** Real PostgreSQL outbox checks. Explicit disposable identity; no real mail or Calendar. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { snapshotHash, type RunSnapshot } from '../lib/mmsSync/contract';

test('durable access queue: readiness, deduplication, late changes, retries, resends and send uncertainty', { skip: process.env.MMS_ACCESS_ISOLATED_TEST !== '1' }, async () => {
    // No use of DATABASE_URL or the application's normal DB configuration.
    const root = path.resolve(__dirname, '..');
    const inside = process.env.MMS_ACCESS_TEST_HOST === 'postgres';
    const connection = { host: inside ? 'postgres' : '127.0.0.1', port: inside ? 5432 : 15439, database: 'mms_access_test', user: 'postgres', password: 'local-test-only' };
    const admin = new Pool(connection);
    assert.equal((await admin.query('SELECT current_database() db')).rows[0].db, 'mms_access_test');
    await admin.query('CREATE SCHEMA IF NOT EXISTS mms_access_fixture');
    const pool = new Pool({ ...connection, options: '-c search_path=mms_access_fixture' });
    const Module = require('node:module');
    const original = Module._load;
    const out: any[] = [];
    let sendResult: any = { success: true, messageId: 'captured-in-test' };
    const dbFile = path.join(root, 'lib/db.ts');
    const sourceFile = path.join(root, 'lib/mmsSync/source.ts');
    const emailFile = path.join(root, 'lib/services/emailService.ts');
    Module._load = function (name: string, parent: any, ...rest: any[]) {
        const resolved = Module._resolveFilename(name, parent);
        if (resolved === dbFile) return { __esModule: true, default: pool };
        if (resolved === sourceFile) return { buildSnapshot: async (_: any, source: any) => structuredClone(source.snapshot) };
        if (resolved === emailFile) return { emailService: { sendEmail: async (message: any) => { out.push(message); return sendResult; } } };
        return original.call(this, name, parent, ...rest);
    };
    const previous = { ...process.env };
    try {
        process.env.MMS_SYNC_ENABLED = 'true'; process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'false';
        process.env.MMS_PUBLIC_ORIGIN = 'https://mms.example.com'; process.env.MMS_ACCESS_SUPPORT = 'support@example.com';
        process.env.MMS_SYNC_COURSE_ALLOWLIST = 'C916';
        await pool.query('CREATE TABLE IF NOT EXISTS course(id uuid PRIMARY KEY,course_code text); CREATE TABLE IF NOT EXISTS course_run(id uuid PRIMARY KEY,course_id uuid,course_run_id text); CREATE TABLE IF NOT EXISTS training_provider(created_at timestamptz,company_email text)');
        await pool.query(readFileSync(path.join(root, 'database/migrations/create_mms_nonfunded_sync.sql'), 'utf8'));
        const migration = readFileSync(path.join(root, 'database/migrations/create_mms_class_access.sql'), 'utf8');
        await pool.query(migration); await pool.query(migration);
        await pool.query("INSERT INTO training_provider VALUES(now(),'support@example.com')");
        const snapshot: RunSnapshot = { schema_version: 1, source_provider_id: 'test', source_run_key: 'calendar:test:access', website_id: 1, course_code: 'C916', course_title: 'Pilot', calendar_id: 'test@example.com', event_occurrences: ['event'], revision: 1, request_id: 'test', snapshot_hash: '', snapshot_at: new Date().toISOString(), roster_complete: true, cancelled: false,
            sessions: [{ key: 's1234567', source_id: 's', date: '2050-10-23', start_time: '09:30', end_time: '17:30', venue: 'Room', virtual_link: '', mode: 1 }],
            trainers: [{ source_id: 'trainer', email: 'trainer@example.com', name: 'Trainer', confirmed: true }], learners: [{ source_id: 'learner', email: 'learner@example.com', name: 'Learner' }], courseware: {}, feedback_url: 'https://tms.example.com/feedback/test',
            handover_approval: { approved_at: '2026-10-21T00:00:00.000Z', approved_by: 'operator', first_session_at: '2050-10-23T01:30:00.000Z' } };
        async function save() {
            snapshot.snapshot_hash = snapshotHash(snapshot);
            const target = { success: true, readiness: 'ready', revision: snapshot.revision, snapshot_hash: snapshot.snapshot_hash, class_id: 'C000001', run_id: 42, participant_login_url: 'https://mms.example.com/lmslogin/', participant_class_url: 'https://mms.example.com/lmslogin/index/class/?run_id=42' };
            await pool.query(`INSERT INTO mms_sync_source(source_run_key,course_code,calendar_id,event_ids,revision,snapshot_hash,snapshot,target_result,approved_at,approved_by,first_session_at,handover_at,last_success_at,auto_sync_until)
                VALUES($1,'C916','test@example.com','["event"]',$2,$3,$4,$5,'2026-10-21','operator','2050-10-23T01:30:00Z','2026-10-21T01:00:00Z',now(),'2050-10-23T12:30:00Z')
                ON CONFLICT(source_run_key) DO UPDATE SET revision=EXCLUDED.revision,snapshot_hash=EXCLUDED.snapshot_hash,snapshot=EXCLUDED.snapshot,target_result=EXCLUDED.target_result,last_error=NULL,last_success_at=now()`,
                [snapshot.source_run_key, snapshot.revision, snapshot.snapshot_hash, snapshot, target]);
        }
        await save();
        await pool.query('UPDATE mms_sync_source SET auto_sync_until=NULL WHERE source_run_key=$1', [snapshot.source_run_key]);
        await pool.query(migration);
        assert.equal(new Date((await pool.query('SELECT auto_sync_until FROM mms_sync_source WHERE source_run_key=$1', [snapshot.source_run_key])).rows[0].auto_sync_until).toISOString(), '2050-10-23T12:30:00.000Z');
        const { recoverAccessNotifications, dispatchAccessNotifications, requestAccessSend } = require('../lib/mmsSync/accessNotifications');
        const { calendarAccessDescription } = require('../lib/mmsSync/accessCalendar');
        const calendar = calendarAccessDescription('LMS: https://lms-tms.tertiaryinfotech.com/\nFeedback: https://lms-tms.tertiaryinfotech.com/feedback/test', 'https://mms.example.com/lmslogin/index/class/?run_id=42');
        assert.match(calendar, /Feedback: https:\/\/lms-tms\.tertiaryinfotech\.com\/feedback\/test/);
        assert.doesNotMatch(calendar, /LMS: https:\/\/lms-tms/);
        assert.equal(calendarAccessDescription(calendar, 'https://mms.example.com/lmslogin/index/class/?run_id=42'), calendar);
        await Promise.all([recoverAccessNotifications(), recoverAccessNotifications()]);
        assert.equal((await pool.query('SELECT count(*) n FROM mms_access_notification')).rows[0].n, '2');
        await dispatchAccessNotifications(); assert.equal(out.length, 0);
        process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'true';
        await pool.query("INSERT INTO mms_sync_job(source_run_key,trigger) VALUES($1,'test-pending-change')", [snapshot.source_run_key]);
        await dispatchAccessNotifications(); assert.equal(out.length, 0);
        await pool.query("UPDATE mms_sync_job SET state='succeeded'; UPDATE mms_access_notification SET available_at=now()");
        // Recovery's Calendar writer is intentionally never invoked while sending is enabled in this test.
        await Promise.all([dispatchAccessNotifications(), dispatchAccessNotifications()]); assert.equal(out.length, 2);
        await dispatchAccessNotifications(); assert.equal(out.length, 2);
        assert.ok(out.every(m => m.avoidDuplicateRetry && m.messageId && !m.text.includes('myskillsfuture')));
        await requestAccessSend(snapshot.source_run_key, 'operator'); assert.equal(out.length, 2);
        await requestAccessSend(snapshot.source_run_key, 'operator', { id: 'learner', role: 'learner' }); assert.equal(out.length, 3);
        // Queue a late learner without sending, then withdraw before dispatch.
        process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'false';
        snapshot.learners.push({ source_id: 'late', email: 'late@example.com', name: 'Late' }); snapshot.revision++; await save(); await recoverAccessNotifications();
        snapshot.learners = snapshot.learners.filter(p => p.source_id !== 'late'); snapshot.revision++; await save(); await recoverAccessNotifications();
        assert.equal((await pool.query("SELECT state FROM mms_access_notification WHERE person_id='late'")).rows[0].state, 'cancelled');
        // Corrected email receives one separately auditable delivery, not a new message every revision.
        snapshot.learners[0].email = 'corrected@example.com'; snapshot.revision++; await save(); await recoverAccessNotifications();
        process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'true';
        sendResult = { success: false, uncertain: true, error: 'Timeout after submission' };
        await dispatchAccessNotifications(); const afterTimeout = out.length;
        assert.equal((await pool.query("SELECT state FROM mms_access_notification WHERE email='corrected@example.com'")).rows[0].state, 'review');
        await dispatchAccessNotifications(); assert.equal(out.length, afterTimeout);
        sendResult = { success: true, messageId: 'captured-correction' };
        await requestAccessSend(snapshot.source_run_key, 'operator', { id: 'learner', role: 'learner' }); assert.equal(out.at(-1).to, 'corrected@example.com');
        // Reclassification must reject even a queued resend and an existing mapping.
        process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'false';
        snapshot.learners.push({ source_id: 'never', email: 'never@example.com', name: 'Never' }); snapshot.revision++; await save(); await recoverAccessNotifications();
        await pool.query("INSERT INTO course VALUES('00000000-0000-0000-0000-000000000001',' tgs-123 '); INSERT INTO course_run(id,course_id) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001')");
        await pool.query("UPDATE mms_sync_source SET tms_run_uuid='00000000-0000-0000-0000-000000000002'");
        process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED = 'true'; const beforeFunded = out.length;
        await dispatchAccessNotifications(); assert.equal(out.length, beforeFunded);
        assert.equal((await pool.query("SELECT state FROM mms_access_notification WHERE person_id='never'")).rows[0].state, 'cancelled');
        await assert.rejects(() => requestAccessSend(snapshot.source_run_key, 'operator'), /not ready/);
        await pool.query("UPDATE mms_sync_source SET auto_sync_until=now()-interval '1 second' WHERE source_run_key=$1", [snapshot.source_run_key]);
        await pool.query(`INSERT INTO mms_access_notification(source_run_key,person_id,role,email,kind,generation,actor,revision,destination)
            VALUES($1,'learner','learner','corrected@example.com','initial','close-test','test',1,'https://mms.example.com/lmslogin/')`, [snapshot.source_run_key]);
        await recoverAccessNotifications();
        assert.equal((await pool.query("SELECT state FROM mms_access_notification WHERE generation='close-test'")).rows[0].state, 'cancelled');
    } finally {
        Module._load = original;
        for (const key of ['MMS_SYNC_ENABLED', 'MMS_ACCESS_NOTIFICATIONS_ENABLED', 'MMS_PUBLIC_ORIGIN', 'MMS_ACCESS_SUPPORT', 'MMS_SYNC_COURSE_ALLOWLIST']) {
            if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
        }
        await pool.end();
        await admin.query('DROP SCHEMA mms_access_fixture CASCADE');
        await admin.end();
    }
});
