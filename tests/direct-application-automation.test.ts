import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const connection = process.env.DA_AUTOMATION_TEST_DATABASE_URL;

test('direct application automation (disposable Postgres; no live services)', { skip: !connection }, async t => {
  const url = new URL(connection!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15543', 'Refuse to run mutation tests against anything except the disposable test port');
  process.env.DATABASE_URL = connection;
  process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT = 'test-only-service-key';
  process.env.ENABLE_APP_SCHEDULER = 'false';
  const { default: db } = await import('../lib/db');
  const { runDirectApplicationAutomation, DA_AUTOMATION_CRON } = await import('../lib/directApplicationAutomation');
  const { withDaLock } = await import('../lib/daAutomationLock');
  const { importDirectApplications } = await import('../pages/api/admin/upload-da-applications');
  const { processDirectApplication } = await import('../lib/autoEnrolDirectApplications');
  const ownedApps: string[] = [];
  const ownedReports: string[] = [];
  const makeRow = (status = 'Confirmed', date = '2099-01-01') => {
    const id = `TEST-DA-AUTO-${randomUUID()}`;
    ownedApps.push(id);
    return { 'Application ID': id, 'Application Status': status, 'Course Start Date': date, 'Course Run ID': `test-${randomUUID()}` };
  };
  const insert = async (row: Record<string, string>, enrolment: string | null = null, status: string | null = null) => {
    const id = randomUUID();
    await db.query(`INSERT INTO da_application (id, application_id, application_status, course_start_date, enrolment_id, auto_enrol_status)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, row['Application ID'], row['Application Status'], row['Course Start Date'], enrolment, status]);
    return id;
  };
  const run = async (deps: Parameters<typeof runDirectApplicationAutomation>[0]) => {
    const report = await runDirectApplicationAutomation(deps);
    if (report) ownedReports.push(report.id);
    return report!;
  };
  const noImport = async () => ({ inserted: 0, updated: 0, errors: [] });
  try {
    await t.test('schedule has four daily Singapore slots', () => {
      assert.equal(DA_AUTOMATION_CRON, '0 9,12,15,18 * * *');
    });
    await t.test('manual import can defer its background enrolment', async () => {
      const row = makeRow();
      const imported = await importDirectApplications([row], { enqueue: false });
      assert.equal(imported.inserted, 1);
      assert.deepEqual(imported.errors, []);
      const stored = await db.query('SELECT auto_enrol_status FROM da_application WHERE application_id=$1', [row['Application ID']]);
      assert.equal(stored.rows[0].auto_enrol_status, null);
    });
    await t.test('Confirmed (Pending payment) imports follow the same transition as Confirmed', async () => {
      const row = makeRow('Confirm application'); await insert(row);
      const imported = await importDirectApplications([{ ...row, 'Application Status': 'Confirmed (Pending payment)' }], { enqueue: false });
      assert.equal(imported.updated, 1);
      const stored = await db.query('SELECT application_status FROM da_application WHERE application_id=$1', [row['Application ID']]);
      assert.equal(stored.rows[0].application_status, 'Confirmed (Pending payment)');
    });
    await t.test('explicit empty manual selection does not enrol every eligible application', async () => {
      const { default: handler } = await import('../pages/api/admin/auto-enrol-direct-applications');
      let httpStatus = 0; let body: any;
      const response = { setHeader() {}, status(code: number) { httpStatus = code; return this; }, json(value: unknown) { body = value; return this; } };
      await handler({ method: 'POST', headers: { 'x-api-key': 'test-only-service-key' }, body: { applicationIds: [] } } as any, response as any);
      assert.equal(httpStatus, 200); assert.equal(body.queued, 0);
    });
    await t.test('retry earlier pending/failed manual attempts, skip enrolled and deduplicate fetched IDs', async () => {
      const pending = makeRow(); const failed = makeRow('Confirmed (Pending payment)'); const done = makeRow(); const manual = makeRow();
      const pendingId = await insert(pending, null, 'pending');
      const failedId = await insert(failed, null, 'failed');
      await insert(done, 'ENR-EXISTING'); await insert(manual, 'MANUAL');
      const report = await run({ retrieve: async () => ({ rows: [pending, failed, done, manual, pending] }), importRows: noImport,
        process: async ids => {
          assert.deepEqual(new Set(ids), new Set([pendingId, failedId]));
          return ids.map(id => ({ id, applicationId: '', success: true, finalStatus: 'enroled', enrolmentId: `ENR-${id}` }));
        } });
      assert.equal(report.fetched, 4); assert.equal(report.enrolled, 2); assert.equal(report.already_enrolled, 2);
      assert.equal(report.status, 'completed');
      const stored = await db.query('SELECT * FROM da_automation_run WHERE id=$1', [report.id]);
      assert.ok(stored.rows[0].completed_at); assert.equal(stored.rows[0].enrolled, 2);
    });
    await t.test('past, cancelled, unconfirmed and undated applications cannot auto-enrol', async () => {
      const report = await run({ retrieve: async () => ({ rows: [makeRow('Cancelled'), makeRow('Confirm application'), makeRow('Confirmed', '2020-01-01'), makeRow('Confirmed', '')] }),
        importRows: async rows => { assert.equal(rows.length, 0); return noImport(); },
        process: async ids => { assert.equal(ids.length, 0); return []; } });
      assert.equal(report.fetched, 0); assert.equal(report.status, 'completed');
    });
    await t.test('fetch failures are audited and never start import/enrolment', async () => {
      const report = await run({ retrieve: async () => { throw new Error('TPG unavailable'); },
        importRows: async () => { assert.fail('must not import after fetch failure'); },
        process: async () => { assert.fail('must not enrol after fetch failure'); } });
      assert.equal(report.status, 'failed'); assert.equal(report.error_count, 1); assert.equal(report.errors[0].step, 'fetch');
    });
    await t.test('enrolment success and downstream failure are reported separately', async () => {
      const row = makeRow(); const id = await insert(row);
      const report = await run({ retrieve: async () => ({ rows: [row] }), importRows: noImport,
        process: async () => [{ id, applicationId: row['Application ID'], success: false, finalStatus: 'failed', enrolmentId: 'ENR-NEW', failedStep: 'invoice', error: 'Invoice unavailable' }] });
      assert.equal(report.enrolled, 1); assert.equal(report.error_count, 1); assert.equal(report.status, 'completed_with_errors');
    });
    await t.test('failed imports are never enrolled even when an old row exists', async () => {
      const row = makeRow(); await insert(row);
      const report = await run({ retrieve: async () => ({ rows: [row] }), importRows: async () => ({ inserted: 0, updated: 0, errors: [{ row: 0, application_id: row['Application ID'], error: 'Write failed' }] }),
        process: async ids => { assert.equal(ids.length, 0); return []; } });
      assert.equal(report.error_count, 1); assert.equal(report.attempted, 0);
    });
    await t.test('concurrent automatic runs do not fetch or enrol twice', async () => {
      let finish!: () => void; let started!: () => void;
      const waiting = new Promise<void>(resolve => { finish = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      const first = run({ retrieve: async () => { started(); await waiting; return { rows: [] }; }, importRows: noImport, process: async () => [] });
      await entered;
      const second = await runDirectApplicationAutomation({ retrieve: async () => { assert.fail('duplicate fetch'); }, importRows: noImport, process: async () => [] });
      assert.equal(second, null); finish(); await first;
    });
    await t.test('manual and scheduled processing share the same row lock', async () => {
      const row = makeRow(); const id = await insert(row);
      await withDaLock(db, `application:${id}`, async () => {
        const result = await processDirectApplication(id);
        assert.equal(result.skipped, true); assert.equal(result.failedStep, 'busy');
      });
      const result = await processDirectApplication(id);
      assert.equal(result.finalStatus, 'pending_identity');
      const stored = await db.query('SELECT auto_enrol_status,auto_enrol_error FROM da_application WHERE id=$1', [id]);
      assert.equal(stored.rows[0].auto_enrol_status, 'pending_identity'); assert.ok(stored.rows[0].auto_enrol_error);
    });
    await t.test('unexpected pipeline failures persist failed status rather than Processing', async () => {
      const row = makeRow(); const id = await insert(row, null, 'pending');
      const query = db.query.bind(db);
      db.query = ((sql: any, ...args: any[]) => {
        if (typeof sql === 'string' && sql.includes('da.*')) throw new Error('Injected pipeline failure');
        return (query as any)(sql, ...args);
      }) as typeof db.query;
      try { const result = await processDirectApplication(id); assert.equal(result.finalStatus, 'failed'); }
      finally { db.query = query as typeof db.query; }
      const stored = await db.query('SELECT auto_enrol_status,auto_enrol_error FROM da_application WHERE id=$1', [id]);
      assert.equal(stored.rows[0].auto_enrol_status, 'failed'); assert.match(stored.rows[0].auto_enrol_error, /Injected pipeline failure/);
    });
    await t.test('scheduled pipeline rechecks enrolment under its row lock after a manual run finishes', async () => {
      const row = makeRow(); const id = await insert(row, 'ENR-JUST-FINISHED');
      const result = await processDirectApplication(id, undefined, { onlyUnenrolled: true });
      assert.equal(result.skipped, true); assert.equal(result.failedStep, 'already_enrolled'); assert.equal(result.success, true);
    });
    await t.test('interrupted process history remains visible after retry', async () => {
      const staleId = randomUUID(); ownedReports.push(staleId);
      await db.query("INSERT INTO da_automation_run (id,status) VALUES ($1,'running')", [staleId]);
      await run({ retrieve: async () => ({ rows: [] }), importRows: noImport, process: async () => [] });
      const stored = await db.query('SELECT status,error_count FROM da_automation_run WHERE id=$1', [staleId]);
      assert.equal(stored.rows[0].status, 'interrupted'); assert.equal(stored.rows[0].error_count, 1);
    });
  } finally {
    await db.query('DELETE FROM da_application WHERE application_id = ANY($1::text[])', [ownedApps]);
    await db.query('DELETE FROM da_automation_run WHERE id = ANY($1::uuid[])', [ownedReports]);
    await db.end();
  }
});
