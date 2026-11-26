import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { calendar_v3 } from 'googleapis';

// Replace dependencies BEFORE loading the existing helper: lib/db has startup
// migrations, which must never run against an operational database in a test.
const fixtureRequire = createRequire(path.join(process.cwd(), 'tests/calendar-course-info-runtime.test.ts'));
const now = new Date('2026-11-23T07:00:00Z');
const queries: { sql: string; values?: unknown[] }[] = [];
const lists: Record<string, unknown>[] = [];
const patches: { params: any; options: any }[] = [];
let enabled = true;
let failPage = false;
let mmsSettings: Record<string, string> | null = null;
let remote: Map<string, calendar_v3.Schema$Event>;
const course = { id: 'fixture-run', course_run_id: '1449949', course_code: 'TGS-2023037472', title: 'Business Innovation',
  start_date: '2026-11-23', end_date: '2026-11-24', course_code_aliases: ['TGS-2023037472'],
  active: true, aliases: ['TGS-2023037472'], dates: [], mappings: [{ eventId: 'day-one', date: '2026-11-23' }, { eventId: 'day-two', date: '2026-11-24' }] };
const database = {
  query: async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rows: sql.includes('FROM course_run cr') ? [structuredClone(course)]
      : sql.includes('tertiary_courses_sg_api_key') && mmsSettings ? [mmsSettings] : [] };
  },
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
};
const calendar = { events: {
  list: async (params: Record<string, unknown>) => {
    lists.push(params);
    if (params.pageToken && failPage) throw new Error('synthetic inventory failure');
    return { data: params.pageToken ? { items: [structuredClone(remote.get('day-two'))] }
      : { items: [structuredClone(remote.get('day-one'))], nextPageToken: 'second-page' } };
  },
  get: async ({ eventId }: { eventId: string }) => ({ data: structuredClone(remote.get(eventId)) }),
  patch: async (params: any, options: any) => {
    patches.push({ params, options });
    assert.equal(params.sendUpdates, 'none');
    assert.deepEqual(Object.keys(params.requestBody), ['description']);
    assert.equal(options.headers['If-Match'], remote.get(params.eventId)!.etag);
    remote.set(params.eventId, { ...remote.get(params.eventId), ...params.requestBody, etag: 'after' });
    return { data: {} };
  },
} };
function substitute(name: string, exports: unknown) {
  const filename = fixtureRequire.resolve(name);
  fixtureRequire.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module;
}
substitute('../lib/db', database);
substitute('../lib/calendar/calendarClient', { getCalendarClient: async () => enabled ? { calendar, calendarId: 'fixture-calendar' } : null,
  getCalendarReadClient: async () => ({ calendar, calendarId: 'fixture-calendar' }) });
substitute('../lib/trainingPartnerIdentifiers', { getTrainingPartnerIdentifiers: async () => ({ companyAddress: 'Test only' }) });
const { syncExistingCalendarCourseInfo, stampCalendarCourseInfo } = fixtureRequire('../lib/calendar/ensureClassCalendarEvent') as typeof import('../lib/calendar/ensureClassCalendarEvent');

function reset() {
  queries.length = lists.length = patches.length = 0; enabled = true; failPage = false; mmsSettings = null;
  remote = new Map(['day-one', 'day-two'].map((id, index) => [id, { id, etag: 'before', status: 'confirmed', description: 'Keep this note',
    start: { dateTime: `2026-11-${index ? '24' : '23'}T09:30:00+08:00` }, attendees: [{ email: 'existing@example.test', responseStatus: 'accepted' }] }]));
}

test('existing runtime collects all pages, includes mapped classes without sessions, and only patches descriptions', async () => {
  reset();
  const result = await syncExistingCalendarCourseInfo({ now });
  assert.equal(result.updated, 2); assert.equal(result.errors, 0);
  assert.equal(lists.length, 2);
  assert.equal(lists[0].timeMin, '2026-11-23T00:00:00+08:00');
  assert.equal(lists[0].timeMax, '2027-11-24T00:00:00+08:00');
  assert.equal(lists[1].pageToken, 'second-page');
  assert.ok(queries.some(q => q.sql.includes('AS mappings') && !q.sql.includes('FROM enrollment')));
  assert.equal(patches.length, 2);
  assert.equal(remote.get('day-one')!.attendees![0].responseStatus, 'accepted');
});

test('post-import target checks use its dates and include competing runs in that range', async () => {
  reset();
  await syncExistingCalendarCourseInfo({ now, courseRunId: 'fixture-run' });
  assert.equal(lists[0].timeMax, '2026-11-25T00:00:00+08:00');
  const candidates = queries.filter(q => q.sql.includes('AS mappings'));
  assert.deepEqual(candidates[0].values, ['2026-11-23', '2026-11-25']);
  assert.ok(!candidates[0].sql.includes('WHERE cr.course_run_id = $1'));
});

test('disabled Calendar performs no inventory/query/write; incomplete inventory cannot result in writes', async () => {
  reset(); enabled = false;
  assert.equal((await syncExistingCalendarCourseInfo({ now })).status, 'skipped');
  assert.equal(queries.length, 0); assert.equal(lists.length, 0); assert.equal(patches.length, 0);
  reset(); failPage = true;
  await assert.rejects(syncExistingCalendarCourseInfo({ now }), /inventory failure/);
  assert.equal(patches.length, 0);
});

test('existing shared stamper preserves notes and its timestamp on repeated checks', async () => {
  reset();
  const fields = { title: course.title, courseCode: course.course_code, courseRunId: course.course_run_id };
  assert.equal((await stampCalendarCourseInfo(calendar as any, 'fixture-calendar', 'day-one', fields, now)).status, 'updated');
  const stamped = remote.get('day-one')!.description;
  assert.ok(stamped!.startsWith('Keep this note'));
  assert.equal((await stampCalendarCourseInfo(calendar as any, 'fixture-calendar', 'day-one', fields, new Date('2027-01-01'))).status, 'unchanged');
  assert.equal(patches.length, 1); assert.equal(remote.get('day-one')!.description, stamped);
});

function mmsEvents() {
  for (const [id, entry] of remote) remote.set(id, { ...entry, description: 'C1097', recurringEventId: 'mms-series',
    end: { dateTime: entry.start!.dateTime!.replace('09:30:00', '17:30:00') } });
  mmsSettings = { tertiary_courses_sg_url: 'https://mms.example.test', tertiary_courses_sg_api_key: 'synthetic-mms-key' };
}
const payload = { data: { course_code: 'C1097', course_title: 'Power Query and Power Pivot', classes_count: 1,
  classes: [{ class_id: 'C004124', raw: '23/24 Nov 2026', start_date: '2026-11-23', end_date: '2026-11-24', time: '09:30-17:30', status: 'Pending' }] } };

test('existing runtime reads its configured MMS connection, caches per SKU, and keeps the same window and write policy', async () => {
  reset(); mmsEvents(); const savedFetch = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (url: URL, init: RequestInit) => {
    calls.push(String(url)); assert.equal(new URL(url).searchParams.get('sku'), 'C1097');
    assert.equal((init.headers as Record<string, string>)['X-API-Key'], 'synthetic-mms-key');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await syncExistingCalendarCourseInfo({ now });
    assert.equal(result.nonFunded!.updated, 2); assert.equal(calls.length, 2);
    assert.equal(queries.filter(q => q.sql.includes('tertiary_courses_sg_api_key')).length, 1);
    assert.equal(lists[0].timeMin, '2026-11-23T00:00:00+08:00');
    assert.equal(lists[0].timeMax, '2027-11-24T00:00:00+08:00');
    assert.ok(remote.get('day-one')!.description!.includes('MMS Class ID: C004124'));
    assert.equal(remote.get('day-one')!.attendees![0].responseStatus, 'accepted');
  } finally { globalThis.fetch = savedFetch; }
});

test('missing/rejected MMS credentials and invalid upstream JSON do not patch any C-code event', async () => {
  const savedFetch = globalThis.fetch;
  try {
    for (const mode of ['missing', 'unauthorized', 'invalid-json', 'redirect']) {
      reset(); mmsEvents(); let calls = 0;
      if (mode === 'missing') mmsSettings = null;
      globalThis.fetch = (async () => {
        calls++;
        if (mode === 'redirect') throw new Error('synthetic redirect with sensitive details');
        return new Response(mode === 'invalid-json' ? 'not json' : '{"error":"private upstream detail"}', { status: mode === 'unauthorized' ? 401 : 200 });
      }) as typeof fetch;
      const result = await syncExistingCalendarCourseInfo({ now });
      assert.equal(result.nonFunded!.errors, 2); assert.equal(patches.length, 0);
      assert.equal(calls, mode === 'missing' ? 0 : 1);
      assert.doesNotMatch(JSON.stringify(result), /sensitive|private upstream/);
    }
  } finally { globalThis.fetch = savedFetch; }
});

test('existing runtime dry-run uses the read client and returns proposals without Calendar writes', async () => {
  reset(); mmsEvents(); enabled = false; const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(payload))) as typeof fetch;
  try {
    const result = await syncExistingCalendarCourseInfo({ now, dryRun: true });
    assert.equal(result.updated, 0); assert.equal(patches.length, 0);
    assert.equal(result.details.filter(d => d.status === 'would_update').length, 2);
  } finally { globalThis.fetch = savedFetch; }
});
