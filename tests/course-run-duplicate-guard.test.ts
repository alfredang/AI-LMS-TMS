import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoDuplicateCourseRunDates,
  countRunsOnDates,
  DuplicateCourseRunDateError,
  fetchExistingRunsByDate,
} from '../lib/ssg/courseRunDuplicateGuard';

// A fake SSG run search: `pages[n]` is what page n returns.
const run = (id: number, start: string, end: string) => ({ id, courseDates: { start, end } });
const fakeApi = (pages: any[][], opts: { body?: (runs: any[]) => any; ignorePage?: boolean } = {}) => {
  const calls: number[] = [];
  return {
    calls,
    searchCourseRunsByCode: async (_code: string, o: any = {}) => {
      const page = opts.ignorePage ? 0 : o.page ?? 0;
      calls.push(page);
      const runs = pages[page] ?? [];
      return { status: 200, data: opts.body ? opts.body(runs) : { data: { course: { runs } } } };
    },
  };
};

test('blocks a run whose exact dates SSG already holds', async () => {
  const api = fakeApi([[run(1, '20261114', '20261115')]]);
  await assert.rejects(
    assertNoDuplicateCourseRunDates({ api, courseReferenceNumber: 'TGS-1', runs: [{ courseDates: { start: 20261114, end: 20261115 } }] }),
    (e: any) => e instanceof DuplicateCourseRunDateError && e.existingRunId === '1',
  );
});

test('allows dates SSG does not hold, including the same start with another end', async () => {
  const api = fakeApi([[run(1, '20261114', '20261115')]]);
  await assertNoDuplicateCourseRunDates({ api, courseReferenceNumber: 'TGS-1', runs: [{ courseDates: { start: 20261114, end: 20261114 } }] });
});

test('finds a duplicate on the second page of runs', async () => {
  const first = Array.from({ length: 100 }, (_, i) => run(1000 + i, '20260101', `202601${String(i % 28 + 1).padStart(2, '0')}`));
  const api = fakeApi([first, [run(5, '20261201', '20261202')]]);
  await assert.rejects(
    assertNoDuplicateCourseRunDates({ api, courseReferenceNumber: 'TGS-1', runs: [{ courseDates: { start: 20261201, end: 20261202 } }] }),
    DuplicateCourseRunDateError,
  );
  assert.deepEqual(api.calls, [0, 1]);
});

test('fails closed when SSG answers 200 with no run list', async () => {
  const api = fakeApi([[]], { body: () => ({ data: { course: {} } }) });
  await assert.rejects(
    assertNoDuplicateCourseRunDates({ api, courseReferenceNumber: 'TGS-1', runs: [{ courseDates: { start: 20261114, end: 20261115 } }] }),
    /no run list/,
  );
});

test('fails closed when SSG returns an error', async () => {
  const api = { searchCourseRunsByCode: async () => ({ status: 500, error: { message: 'boom' } }) };
  await assert.rejects(
    assertNoDuplicateCourseRunDates({ api, courseReferenceNumber: 'TGS-1', runs: [{ courseDates: { start: 20261114, end: 20261115 } }] }),
    /boom/,
  );
});

test('stops paging when SSG repeats the same page instead of looping', async () => {
  const full = Array.from({ length: 100 }, (_, i) => run(i + 1, '20260101', '20260102'));
  const api = fakeApi([full], { ignorePage: true });
  const byDate = await fetchExistingRunsByDate(api, 'TGS-1');
  assert.equal(api.calls.length, 2);
  assert.equal(byDate.get('2026-01-01|2026-01-02')!.split('/').length, 100);
});

test('countRunsOnDates reports how many runs share the dates', async () => {
  const api = fakeApi([[run(1, '20261114', '20261115'), run(2, '20261114', '20261115'), run(3, '20261121', '20261122')]]);
  assert.deepEqual(await countRunsOnDates(api, 'TGS-1', '2026-11-14', '2026-11-15'), { count: 2, runIds: ['1', '2'] });
  assert.deepEqual(await countRunsOnDates(api, 'TGS-1', '2026-11-21', '2026-11-22'), { count: 1, runIds: ['3'] });
});
