/** Real disposable PG; Calendar, MMS HTTP and mail are in-process test doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { type RunSnapshot } from '../lib/mmsSync/contract';

test('usual TMS assignments bootstrap sync and MMS courseware mail, retaining TMS data and excluding midway/funded runs', { skip: process.env.MMS_ACCESS_ISOLATED_TEST !== '1' }, async () => {
    const connection = { host: process.env.MMS_ACCESS_TEST_HOST === 'postgres' ? 'postgres' : '127.0.0.1', port: process.env.MMS_ACCESS_TEST_HOST === 'postgres' ? 5432 : 15439, database: 'mms_access_test', user: 'postgres', password: 'local-test-only' };
    const admin = new Pool(connection);
    assert.equal((await admin.query('SELECT current_database() db')).rows[0].db, 'mms_access_test');
    await admin.query('CREATE SCHEMA mms_operations_fixture');
    const pool = new Pool({ ...connection, options: '-c search_path=mms_operations_fixture' });
    const root = path.resolve(__dirname, '..');
    const previous = { ...process.env }; const oldFetch = globalThis.fetch;
    const Module = require('node:module'); const original = Module._load;
    const classId = '00000000-0000-0000-0000-000000000001';
    const sources = ['future', 'midway'].map(key => ({ source_run_key: `calendar:test:${key}`, course_code: 'C817', calendar_id: 'sales@example.com', event_ids: [key], tms_run_uuid: null, masterlist_class_id: key === 'future' ? classId : '00000000-0000-0000-0000-000000000002' }));
    const writes: RunSnapshot[] = []; const messages: any[] = [];
    const readClient = { calendarId: 'sales@example.com', calendar: { events: { get: async ({ eventId }: any) => ({ data: { id: eventId } }) } } };
    Module._load = function(name: string, parent: any, ...rest: any[]) {
        const resolved = Module._resolveFilename(name, parent);
        if (resolved === path.join(root, 'lib/db.ts')) return { __esModule: true, default: pool };
        if (resolved === path.join(root, 'lib/calendar/calendarClient.ts')) return { getCalendarReadClient: async () => readClient };
        if (resolved === path.join(root, 'lib/mmsSync/accessCalendar.ts')) return { updateAccessCalendar: async () => {} };
        if (resolved === path.join(root, 'lib/services/emailService.ts')) return { emailService: { sendEmail: async (message: any) => { messages.push(message); return { success: true, messageId: 'captured-only' }; } } };
        if (resolved === path.join(root, 'lib/mmsSync/source.ts')) return {
            calendarEvents: async () => ({ calendarId: 'sales@example.com', events: sources.map((s, i) => ({ id: i })) }),
            resolveEvent: async (_: any, __: any, event: any) => sources[event.id === 'future' ? 0 : event.id === 'midway' ? 1 : event.id],
            buildSnapshot: async (_: any, source: any): Promise<RunSnapshot> => {
                const rows = (await pool.query('SELECT * FROM masterlist_table WHERE class_id=$1', [source.masterlist_class_id])).rows;
                return { schema_version: 1, source_provider_id: 'test', source_run_key: source.source_run_key, website_id: 1, course_code: source.course_code, course_title: 'Fixture', calendar_id: source.calendar_id, event_occurrences: source.event_ids, revision: 0, request_id: '', snapshot_hash: '', snapshot_at: new Date().toISOString(), roster_complete: true, cancelled: false,
                    sessions: [{ key: 's1234567', source_id: source.event_ids[0], date: source.event_ids[0] === 'future' ? '2050-10-23' : '2026-10-20', start_time: '09:30', end_time: '17:30', venue: 'Room', virtual_link: '', mode: 1 }],
                    trainers: rows[0]?.trainer_email ? [{ source_id: 'trainer', email: rows[0].trainer_email, name: 'Trainer', confirmed: true }] : [],
                    learners: rows.filter((r: any) => r.email).map((r: any) => ({ source_id: r.email, email: r.email, name: r.name })), courseware: {}, feedback_url: 'https://tms.example.com/feedback/test' };
            },
        };
        return original.call(this, name, parent, ...rest);
    };
    try {
        Object.assign(process.env, { MMS_SYNC_ENABLED: 'true', MMS_SYNC_AUTOMATIC: 'true', MMS_SYNC_COURSE_ALLOWLIST: 'C*', MMS_SYNC_URL: 'https://mms.example.com/import', MMS_SYNC_API_KEY: 'synthetic-only', MMS_PUBLIC_ORIGIN: 'https://mms.example.com', MMS_ACCESS_NOTIFICATIONS_ENABLED: 'true', MMS_ACCESS_SUPPORT: 'support@example.com' });
        await pool.query(`CREATE TABLE course(id uuid PRIMARY KEY,course_code text); CREATE TABLE course_run(id uuid PRIMARY KEY,course_id uuid,course_run_id text);
            CREATE TABLE training_provider(created_at timestamptz,company_email text);
            CREATE TABLE masterlist_table(class_id uuid,name text,email text,trainer_email text,calendar_event_id text);
            INSERT INTO training_provider VALUES(now(),'support@example.com');`);
        for (const file of ['create_mms_nonfunded_sync.sql', 'create_mms_class_access.sql']) await pool.query(readFileSync(path.join(root, 'database/migrations', file), 'utf8'));
        await pool.query("INSERT INTO masterlist_table VALUES($1,'Learner','learner@example.com','trainer@example.com','future'),($2,'Old Learner','old@example.com','oldtrainer@example.com','midway')", [classId, sources[1].masterlist_class_id]);
        const before = (await pool.query('SELECT * FROM masterlist_table ORDER BY class_id')).rows;
        globalThis.fetch = async (_url: any, options: any) => {
            const data = JSON.parse(options.body); writes.push(data);
            return new Response(JSON.stringify({ success: true, readiness: 'ready', revision: data.revision, snapshot_hash: data.snapshot_hash, class_id: 'SG000001', run_id: 42, participant_login_url: 'https://mms.example.com/lmslogin/', participant_class_url: 'https://mms.example.com/lmslogin/index/class/?run_id=42' }), { status: 200 });
        };
        // The existing courseware sender arrives before nightly discovery or an MMS approval click.
        const { learnerMail } = require('../lib/mmsSync/legacyRouting');
        const mail = await learnerMail({ masterlistClassId: classId, courseCode: 'C817' }, { name: 'Learner', email: 'learner@example.com', title: 'Fixture', dates: '2050-10-23', venue: 'Room', support: 'support@example.com' });
        assert.match(mail.text, /https:\/\/mms\.example\.com\/lmslogin\/index\/class\/\?run_id=42/);
        assert.doesNotMatch(mail.text, /TMS login|lms-tms/);
        assert.equal(writes.length, 1);
        assert.equal((await pool.query('SELECT approved_by FROM mms_sync_source')).rows[0].approved_by, 'tms-normal-operations');
        assert.deepEqual((await pool.query('SELECT * FROM masterlist_table ORDER BY class_id')).rows, before);
        const { dispatchAccessNotifications } = require('../lib/mmsSync/accessNotifications');
        await dispatchAccessNotifications(); assert.equal(messages.length, 2);
        assert.ok(messages.every(m => m.text.includes('https://mms.example.com/lmslogin/')));
        const { discover, processJobs } = require('../lib/mmsSync/service');
        await discover(); await processJobs();
        assert.ok(writes.every(s => s.source_run_key === sources[0].source_run_key));
        assert.equal(await learnerMail({ masterlistClassId: sources[1].masterlist_class_id, courseCode: 'C817' }, { name: 'Old', email: 'old@example.com', title: 'Old', dates: '', venue: '', support: '' }), null);
        const beforeFunded = writes.length;
        assert.equal(await learnerMail({ masterlistClassId: classId, courseCode: ' tgs-123 ' }, { name: '', email: '', title: '', dates: '', venue: '', support: '' }), null);
        assert.equal(writes.length, beforeFunded);
        // A normal saved late assignment uses the transactional change queue.
        await pool.query("INSERT INTO masterlist_table VALUES($1,'Late','late@example.com','trainer@example.com',NULL)", [classId]);
        await processJobs();
        assert.equal(writes.at(-1)?.learners.length, 2);
        assert.equal((await pool.query('SELECT count(*) n FROM masterlist_table WHERE class_id=$1', [classId])).rows[0].n, '2');
        await dispatchAccessNotifications(); assert.equal(messages.length, 3);
        await processJobs(); await dispatchAccessNotifications(); assert.equal(messages.length, 3);
        // Database settings override the old deployment variables and can be
        // paused or refreshed without restarting the TMS process.
        const { loadMmsRuntimeConfig } = require('../lib/mmsSync/runtimeConfig');
        const { mmsSyncEnabled } = require('../lib/mmsSync/service');
        const { notificationsEnabled } = require('../lib/mmsSync/accessNotifications');
        await pool.query(`INSERT INTO mms_handover_config(id,enabled,automatic,notifications_enabled,url,api_key,course_allowlist,public_origin)
            VALUES(1,false,true,false,'https://mms.example.com/import','fixture-only','C817','https://mms.example.com')`);
        assert.equal((await loadMmsRuntimeConfig(true)).pilotStartDate, '2026-10-23');
        assert.equal(mmsSyncEnabled(), false);
        assert.equal(await learnerMail({ masterlistClassId: classId, courseCode: 'C817' }, { name: '', email: '', title: '', dates: '', venue: '', support: '' }), null);
        await pool.query('UPDATE mms_handover_config SET enabled=true WHERE id=1');
        await loadMmsRuntimeConfig(true);
        assert.equal(mmsSyncEnabled(), true);
        assert.equal(notificationsEnabled(), false);
        assert.equal(await learnerMail({ masterlistClassId: classId, courseCode: ' tgs-123 ' }, { name: '', email: '', title: '', dates: '', venue: '', support: '' }), null);
        await pool.query('DELETE FROM mms_handover_config WHERE id=1');
        await loadMmsRuntimeConfig(true);
    } finally {
        Module._load = original; globalThis.fetch = oldFetch;
        for (const key of ['MMS_SYNC_ENABLED','MMS_SYNC_AUTOMATIC','MMS_SYNC_COURSE_ALLOWLIST','MMS_SYNC_URL','MMS_SYNC_API_KEY','MMS_PUBLIC_ORIGIN','MMS_ACCESS_NOTIFICATIONS_ENABLED','MMS_ACCESS_SUPPORT']) {
            if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
        }
        await pool.end(); await admin.query('DROP SCHEMA mms_operations_fixture CASCADE'); await admin.end();
    }
});
