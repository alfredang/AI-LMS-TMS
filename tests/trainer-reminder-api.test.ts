import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { buildReminderSnapshot, type ReminderSnapshotInput } from '../lib/calendar/trainerReminderSnapshot';
import { ReminderSourceUnavailableError } from '../lib/calendar/readReminderEvents';

const trainer = { user_id: '11111111-1111-1111-1111-111111111111', name: 'Trainer', email: 'trainer@example.com', emails: ['trainer@example.com'], phone: '91234567', active: true };
const date = '2026-09-26';
const runUuid = '22222222-2222-2222-2222-222222222222';
const notificationId = '33333333-3333-3333-3333-333333333333';
function fixture(accepted = false): ReminderSnapshotInput {
  return {
    events: [{ id: 'event', summary: 'Course', description: 'Course Run ID: 123', start: { date }, attendees: [{ email: trainer.email, responseStatus: accepted ? 'accepted' : 'needsAction' }] }],
    runs: [{ runUuid, courseRunId: '123', courseCode: 'TGS-1234567890', courseTitle: 'Course', startDate: '2026-09-20', endDate: date, sessionDates: [date], classStatus: 'Confirmed', assignments: [{ user_id: trainer.user_id, email: trainer.email, name: trainer.name }], sessions: [{ date, trainer_id: null }], details: {} }],
    mappings: [], directory: [trainer], queue: [], start: date, end: date, today: '2026-09-23',
  };
}
const pending = () => ({ id: notificationId, runUuid, sessionDate: date, eventId: 'event', trainerUserId: trainer.user_id, trainerEmail: trainer.email, trainerPhone: '+6591234567', status: 'pending', runStartDate: '2026-09-20' });
const cache = new Map<string, string>();
async function loadEndpoint(name: string, dependencies: Record<string, any>) {
  let code = cache.get(name);
  if (!code) {
    const result = await build({
      entryPoints: [path.resolve(name)], bundle: true, write: false, platform: 'node', format: 'cjs',
      plugins: [{ name: 'isolated-reminder-dependencies', setup(b) {
        b.onResolve({ filter: /\/(db|trainerReminderService|trainerWhatsapp)$/ }, args => ({ path: args.path.split('/').pop()!, namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'db'
          ? 'export default globalThis.dependencies.pool;'
          : args.path === 'trainerReminderService'
            ? 'export const getTrainerReminderSnapshot=globalThis.dependencies.snapshot; export const ReminderSourceUnavailableError=globalThis.dependencies.SourceError;'
            : `export const queueClassReminderWhatsApp=globalThis.dependencies.enqueue;
               export const ensureTrainerWhatsappTable=async()=>{};
               export const secondsUntilWhatsappWindow=()=>null;
               export const WHATSAPP_CHANNELS={class_reminder:{kinds:['class_reminder'],maxPerDay:7,windowStartHourSgt:13,windowEndHourSgt:17},invitation:{kinds:['invitation','reminder'],maxPerDay:5,windowStartHourSgt:10,windowEndHourSgt:13}};
               export const WHATSAPP_MIN_GAP_MINUTES=15; export const WHATSAPP_PENDING_TTL_HOURS=72;` }));
      } }],
    });
    code = result.outputFiles[0].text; cache.set(name, code);
  }
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, dependencies: { SourceError: ReminderSourceUnavailableError, ...dependencies }, process: { env: { EXTERNAL_API_KEY_FOR_CLAWDBOT: 'test-only-key' } }, console: { error() {} } });
  return module.exports;
}
function response() {
  return { statusCode: 0, body: null as any, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, status(n: number) { this.statusCode = n; return this; }, json(body: any) { this.body = body; return this; }, end() { return this; } };
}
const request = (method: string, query: Record<string, string> = {}) => ({ method, query, headers: { 'x-api-key': 'test-only-key' } });
const snapshot = (input: ReminderSnapshotInput) => async () => ({ input, rows: buildReminderSnapshot(input), calendarId: 'calendar', fetchedAt: '2026-09-23T00:00:00Z' });

test('report authenticates and returns exact session with eligibility, without DB mutations', async () => {
  const endpoint = await loadEndpoint('pages/api/external/trainer-reminders.ts', { snapshot: snapshot(fixture()), pool: { query: async () => { throw new Error('Unexpected report DB access'); } } });
  const res = response();
  await endpoint.default(request('GET', { start_date: date, end_date: date, send_reminder: 'true' }), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.length, 1); assert.equal(res.body[0].session_date, date); assert.equal(res.body[0].run_start_date, '2026-09-20');
  assert.equal(res.body[0].reminder_recipient.trainer_id, trainer.user_id); assert.equal(res.body[0].trainer, null);
  const rejected = response(); await endpoint.default({ ...request('GET'), headers: {} }, rejected); assert.equal(rejected.statusCode, 401);
});
test('multi-day single-run lookup requires an explicit session date', async () => {
  const endpoint = await loadEndpoint('pages/api/external/trainer-reminders.ts', { snapshot: async () => { throw new Error('Must not infer date'); }, pool: { query: async () => ({ rows: [{ start: '2026-09-20', end: date }] }) } });
  const res = response(); await endpoint.default(request('GET', { course_run_id: '123' }), res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error.code, 'session_date_required');
});
test('queue dry-run uses report eligibility and writes no queue records', async () => {
  let writes = 0;
  const endpoint = await loadEndpoint('pages/api/external/auto-queue-class-reminders.ts', {
    snapshot: snapshot(fixture()), pool: { query: async () => ({ rows: [{ days_in_advance: 3 }] }) }, enqueue: async () => { writes++; return 'queued'; },
  });
  const result = await endpoint.runAutomation({ dryRun: true, now: new Date('2026-09-23T01:00:00Z') });
  assert.equal(result.targetDate, date); assert.equal(result.wouldQueue, 1); assert.equal(result.queued, 0); assert.equal(writes, 0);
  await endpoint.runAutomation({ now: new Date('2026-09-23T01:00:00Z') }); assert.equal(writes, 1);
});
test('source failures fail report and queue closed', async () => {
  for (const name of ['trainer-reminders', 'auto-queue-class-reminders']) {
    let queued = false;
    const endpoint = await loadEndpoint(`pages/api/external/${name}.ts`, { snapshot: async () => { throw new ReminderSourceUnavailableError('offline'); }, pool: { query: async () => ({ rows: [] }) }, enqueue: async () => { queued = true; } });
    const res = response(); await endpoint.default(request(name === 'trainer-reminders' ? 'GET' : 'POST', { start_date: date, end_date: date }), res);
    assert.equal(res.statusCode, 503); assert.equal(queued, false);
  }
});
test('dispatch releases only freshly verified IDs; acceptance and legacy provenance hold release', async () => {
  for (const variant of ['eligible', 'accepted', 'legacy', 'source_failure']) {
    const q = { ...pending(), ...(variant === 'legacy' ? { eventId: null } : {}) };
    const input = fixture(variant === 'accepted'); input.queue = [q];
    let releaseIds: string[] | undefined;
    const endpoint = await loadEndpoint('pages/api/external/whatsapp-notifications.ts', {
      snapshot: variant === 'source_failure' ? async () => { throw new ReminderSourceUnavailableError('offline'); } : snapshot(input),
      pool: { query: async (sql: string, params?: any[]) => {
        if (sql.includes('n.session_date::text')) return { rows: [q] };
        if (sql.includes('AS today_count')) return { rows: [{ today_count: 0, last_dispatched_at: null }] };
        if (sql.includes("SET status = 'dispatched'")) { releaseIds = params?.[1]; assert.ok(sql.includes('id=ANY($2::uuid[])')); return { rows: [] }; }
        return { rows: [] };
      } },
    });
    const res = response(); await endpoint.default(request('GET', { channel: 'class_reminder' }), res);
    if (variant === 'eligible') assert.equal(releaseIds?.[0], notificationId);
    else { assert.equal(releaseIds, undefined); assert.equal(res.body.notifications.length, 0); }
    assert.equal(res.statusCode, variant === 'source_failure' ? 503 : 200);
  }
});

test('actual queue helper stores exact provenance and handles concurrent duplicate insertion', async () => {
  for (const inserted of [true, false]) {
    const calls: Array<{ sql: string; params: any[] }> = [];
    const helper = await loadEndpoint('lib/trainerWhatsapp.ts', { pool: { query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return { rows: sql.includes('INSERT INTO') && inserted ? [{ id: notificationId }] : [] };
    } } });
    const result = await helper.queueClassReminderWhatsApp({ courseRunUuid: runUuid, sessionDate: date, calendarEventId: 'event', trainerUserId: trainer.user_id, trainerEmails: trainer.emails, trainerName: trainer.name, trainerEmail: trainer.email, trainerPhone: '+6591234567', message: 'TEST ONLY - never sent' });
    assert.equal(result, inserted ? 'queued' : 'skipped_duplicate');
    const insert = calls.find(c => c.sql.includes('INSERT INTO'))!;
    assert.ok(insert.sql.includes('ON CONFLICT DO NOTHING'));
    assert.equal(insert.params[5], date); assert.equal(insert.params[6], 'event'); assert.equal(insert.params[7], trainer.user_id);
    assert.ok(calls.some(c => c.sql.includes('CREATE UNIQUE INDEX') && c.sql.includes('course_run_id, session_date, trainer_user_id')));
  }
});
