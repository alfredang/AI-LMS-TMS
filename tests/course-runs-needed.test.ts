import test from 'node:test';
import assert from 'node:assert/strict';
import { planRunsNeeded } from '../lib/ssg/courseRunsNeededPlan';

const items = [
  { course_code: 'TGS-1', start_date: '2026-12-01', end_date: '2026-12-02', raw: '1/2 Dec 2026' },
  { course_code: 'TGS-1', start_date: '2027-01-05', end_date: '2027-01-06' },
  { course_code: 'TGS-2', start_date: '2026-12-10', end_date: '2026-12-11' },
  { course_code: 'TGS-OTHER', start_date: '2026-12-10', end_date: '2026-12-11' },
];

test('publishes every future website schedule of a course SSG has no run for', () => {
  const plan = planRunsNeeded([{ course_code: 'TGS-1', course_title: 'One' }], items, new Map());
  assert.deepEqual(plan.toSubmit.map((i) => i.start_date), ['2026-12-01', '2027-01-05']);
  assert.equal(plan.toSubmit[0].raw, '1/2 Dec 2026');
  assert.deepEqual(plan.courses, [{
    course_code: 'TGS-1', course_title: 'One', submitting: ['2026-12-01', '2027-01-05'], needsDeveloper: [], noWebsiteSchedule: false,
  }]);
});

test('never touches courses the storefront did not ask for', () => {
  const plan = planRunsNeeded([{ course_code: 'TGS-2' }], items, new Map());
  assert.deepEqual(plan.toSubmit.map((i) => i.course_code), ['TGS-2']);
});

test('matches the website schedule by the current SSG code as well', () => {
  const plan = planRunsNeeded([{ course_code: 'TGS-OLD', ssg_course_code: 'tgs-2' }], items, new Map());
  assert.deepEqual(plan.toSubmit.map((i) => i.course_code), ['TGS-2']);
});

test('retries an eligibility failure, leaves any other failure for a developer', () => {
  const failures = new Map([
    ['TGS-1|2026-12-01', { status: 'error', message: 'course not eligible', blocked: true }],
    ['TGS-1|2027-01-05', { status: 'error', message: 'Bad request', blocked: false }],
  ]);
  const plan = planRunsNeeded([{ course_code: 'TGS-1' }], items, failures);
  assert.deepEqual(plan.toSubmit.map((i) => i.start_date), ['2026-12-01']);
  assert.deepEqual(plan.courses[0].needsDeveloper, ['2027-01-05']);
});

test('reports a course with no future website schedule and ignores duplicates', () => {
  const plan = planRunsNeeded([{ course_code: 'TGS-9' }, { course_code: 'tgs-9' }], items, new Map());
  assert.equal(plan.toSubmit.length, 0);
  assert.equal(plan.courses.length, 1);
  assert.equal(plan.courses[0].noWebsiteSchedule, true);
});
