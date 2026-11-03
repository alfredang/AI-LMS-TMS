/** Real isolated PostgreSQL. MMS HTTP is captured; Calendar must never load. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { RunSnapshot } from '../lib/mmsSync/contract';

test('Master List mirroring and reverse registrations are transactional, repeatable and Calendar independent', { skip: process.env.MMS_ACCESS_ISOLATED_TEST !== '1' }, async () => {
    const connection = { host: process.env.MMS_ACCESS_TEST_HOST === 'postgres' ? 'postgres' : '127.0.0.1', port: process.env.MMS_ACCESS_TEST_HOST === 'postgres' ? 5432 : 15439, database: 'mms_access_test', user: 'postgres', password: 'local-test-only' };
    const admin = new Pool(connection);
    assert.equal((await admin.query('SELECT current_database() db')).rows[0].db, 'mms_access_test');
    await admin.query('CREATE SCHEMA mms_masterlist_fixture');
    const pool = new Pool({ ...connection, options: '-c search_path=mms_masterlist_fixture' });
    const root = path.resolve(__dirname, '..');
    const Module = require('node:module'), originalLoad = Module._load, oldFetch = globalThis.fetch;
    const config = { enabled: true, automatic: true, notificationsEnabled: false, url: 'https://mms.example.com/import', apiKey: 'synthetic-only', courseAllowlist: '', pilotStartDate: '2026-10-23', publicOrigin: 'https://mms.example.com', feedbackUrlTemplate: '', providerId: 'test', websiteId: 1, horizonDays: 60, accessSupport: 'support@example.com', source: 'environment' };
    Module._load = function(name: string, parent: any, ...rest: any[]) {
        const resolved = Module._resolveFilename(name, parent);
        if (resolved === path.join(root, 'lib/db.ts')) return { __esModule: true, default: pool };
        if (resolved === path.join(root, 'lib/mmsSync/runtimeConfig.ts')) return { getMmsRuntimeConfig: () => config, loadMmsRuntimeConfig: async () => config };
        if (resolved === path.join(root, 'lib/mmsSync/accessNotifications.ts')) return { recoverAccessNotifications: async () => {} };
        if (String(resolved).includes('/calendar/') || String(resolved).includes('\\calendar\\')) throw new Error('MMS mirroring must never call Calendar.');
        return originalLoad.call(this, name, parent, ...rest);
    };
    const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002', c='00000000-0000-0000-0000-000000000003', d='00000000-0000-0000-0000-000000000004';
    const writes: RunSnapshot[] = [];
    try {
        await pool.query(`CREATE TABLE course(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_code text,title text);
            CREATE TABLE course_run(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid,course_run_id text);
            CREATE TABLE app_user(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,full_name text,account_status text DEFAULT 'active');
            CREATE UNIQUE INDEX app_user_email_lower_key ON app_user(lower(email));
            CREATE TABLE user_role_map(user_id uuid,role text,PRIMARY KEY(user_id,role));
            CREATE TABLE learner_profile(user_id uuid PRIMARY KEY,tel text);
            CREATE TABLE enrollment(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,course_id uuid,course_run_id uuid,enrolment_status text,email text,UNIQUE(user_id,course_run_id));
            CREATE TABLE masterlist_table(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),class_id uuid,class_type text,list_date date,course_title text,course_run_no text,
              trainer text,trainer_email text,name text,email text,contact_no text,magento_order_no text,comments text,cancelled boolean DEFAULT false,
              schedule_entries jsonb DEFAULT '[]',class_date text,venue text,zoom_id text,meeting_id text,calendar_event_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
            INSERT INTO course(course_code,title) VALUES('C916','Pilot'),('TGS-123','Funded');`);
        for (const file of ['create_mms_nonfunded_sync.sql','create_mms_class_access.sql','add_mms_masterlist_mirroring.sql']) await pool.query(readFileSync(path.join(root,'database/migrations',file),'utf8'));
        await pool.query(`INSERT INTO masterlist_table(class_id,class_type,list_date,course_code,course_title,class_date) VALUES
            ($1,'virtual','2099-11-10','C916','Pending class','2020-01-01~2099-11-10'),
            ($2,'virtual','2099-11-10','TGS-123','Funded','2099-11-10'),
            ($3,'virtual','2020-11-10','C916','Ended','2020-11-10'),
            ($4,'virtual',NULL,'C916','No dates yet',NULL)`,[a,b,c,d]);
        globalThis.fetch = async (_url: any, options: any) => {
            const data=JSON.parse(options.body); writes.push(data);
            return new Response(JSON.stringify({ success: true, revision: data.revision, snapshot_hash: data.snapshot_hash, readiness: 'incomplete', run_id: 42, class_id: 'SG000042', native_registrations: data.source_run_key.includes(a) ? [{ email: 'direct@example.com', name: 'Direct MMS Learner' }] : [] }),{ status: 200 });
        };
        const service = require('../lib/mmsSync/service');
        const preview = await service.discover(true);
        assert.equal(preview.queued,0);
        assert.equal((await pool.query('SELECT count(*)::int n FROM mms_sync_source')).rows[0].n,0,'Preview must not register/import classes.');
        writes.splice(0);
        const scan = await service.discover();
        assert.equal(scan.queued,2);
        assert.deepEqual(scan.exceptions,[]);
        const jobs = await service.processJobs();
        assert.equal(jobs.failed,0);
        assert.ok(writes.length>=2);
        assert.ok(writes.every(s=>s.schema_version===2 && s.course_code==='C916'));
        assert.ok(writes.some(s=>s.sessions.length===0 && s.trainers.length===0 && s.learners.length===0));
        assert.equal((await pool.query("SELECT count(*)::int n FROM masterlist_table WHERE class_id=$1 AND email='direct@example.com'",[a])).rows[0].n,1,'Native MMS registration must be consolidated into LMS.');
        await service.discover(); await service.processJobs();
        assert.equal((await pool.query("SELECT count(*)::int n FROM masterlist_table WHERE email='direct@example.com'",[])).rows[0].n,1,'Repeated reconciliation must not duplicate learner.');
        // Reopen old cutoff metadata for a still-running class automatically.
        await pool.query("UPDATE mms_sync_source SET auto_sync_until='2020-01-01',approved_at=NULL WHERE masterlist_class_id=$1",[a]);
        await pool.query("UPDATE masterlist_table SET trainer='New Trainer',trainer_email='newtrainer@example.com' WHERE class_id=$1",[a]);
        await service.discover(); const updated=await service.processJobs();
        assert.equal(updated.failed,0);
        assert.ok(writes.some(s=>s.trainers[0]?.email==='newtrainer@example.com'));
        await pool.query("UPDATE masterlist_table SET trainer='',trainer_email='' WHERE class_id=$1",[a]);
        await service.processJobs();
        assert.equal(writes.filter(s=>s.source_run_key.includes(a)).at(-1)?.trainers.length,0);
        // Legacy Calendar-only source must never reach outbound HTTP.
        await pool.query("INSERT INTO mms_sync_source(source_run_key,course_code,calendar_id) VALUES('calendar:orphan','C916','old')");
        await assert.rejects(()=>service.queueSource('calendar:orphan','manual'),/Only saved Master List/);
        // Reverse registrations on an exact linked LMS run also create normal enrolments.
        const run=(await pool.query("INSERT INTO course_run(course_id,course_run_id) SELECT id,'run-916' FROM course WHERE course_code='C916' RETURNING id")).rows[0];
        const source=(await pool.query('SELECT * FROM mms_sync_source WHERE masterlist_class_id=$1',[a])).rows[0]; source.tms_run_uuid=run.id;
        const reverse=require('../lib/mmsSync/reverseRegistration');
        await reverse.reconcileMmsRegistrations(pool,source,[{email:'direct@example.com',name:'Direct MMS Learner'}]);
        await reverse.reconcileMmsRegistrations(pool,source,[{email:'direct@example.com',name:'Direct MMS Learner'}]);
        assert.equal((await pool.query('SELECT count(*)::int n FROM enrollment')).rows[0].n,1);
        await pool.query("UPDATE masterlist_table SET cancelled=true WHERE email='direct@example.com'");
        await reverse.reconcileMmsRegistrations(pool,source,[{email:'direct@example.com',name:'Changed name'}]);
        assert.equal((await pool.query("SELECT cancelled FROM masterlist_table WHERE email='direct@example.com'")).rows[0].cancelled,true);
        await pool.query("UPDATE masterlist_table SET course_code='C917' WHERE class_id=$1",[a]);
        const changed=await service.discover();
        assert.deepEqual(changed.exceptions,[]);
        const remapped=await service.processJobs();
        assert.equal(remapped.failed,0);
        assert.ok(writes.some(s=>s.course_code==='C917'));
        assert.equal((await pool.query("SELECT count(*)::int n FROM mms_sync_source WHERE masterlist_class_id=$1 AND course_code='C917'",[a])).rows[0].n,1,'Correcting a course code must create the right identity without old mapping conflicts.');
    } finally {
        globalThis.fetch=oldFetch; Module._load=originalLoad;
        await pool.end();
        await admin.query('DROP SCHEMA mms_masterlist_fixture CASCADE'); await admin.end();
    }
});
