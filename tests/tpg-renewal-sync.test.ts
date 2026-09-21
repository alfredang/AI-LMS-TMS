import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRenewalPlan,
  canonicalizeTpgRows,
  computePlanHash,
  inspectCaptureDocument,
  normalizeTitle,
  RenewalPlanError,
  verifyPlanHash,
  type CourseSnapshot,
} from '../lib/tpg/renewalSync';

function course(overrides: Partial<CourseSnapshot> = {}): CourseSnapshot {
  return {
    id: 'course-1',
    title: 'AI for Network Security',
    course_code: 'TGS-2024051414',
    new_course_code: 'TGS-2024051414',
    course_type: 'WSQ',
    funding_validity: '2026-12-18',
    actual_renew_date: '2026-07-19',
    renewal_application_no: 'TPG-2026119885',
    renewed_status: 'Approved / Renewed',
    ...overrides,
  };
}

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Date Submitted': '18-09-2026',
    'Application Ref. No.': 'TPG-2026122842',
    'Course Ref. No.': '',
    'Course Title': 'AI for Network Security',
    'Submission Type': 'New',
    'Course Type': 'Non WSQ',
    Status: 'Draft',
    ...overrides,
  };
}

test('recovers a missing prior application from a newer exact-title draft', () => {
  const rows = canonicalizeTpgRows([submission()], 'Submissions');
  const result = buildRenewalPlan([course()], rows);
  const planned = result.rows[0];
  assert.equal(planned.operation, 'missing-prior-recovered');
  assert.deepEqual(planned.desired, {
    actualRenewDate: '2026-09-18',
    renewalApplicationNo: 'TPG-2026122842',
    renewedStatus: 'Draft',
  });
  assert.deepEqual(planned.matchEvidence, ['exact-title']);
  assert.equal(result.summary.missingPriorRecovered, 1);
});

test('selects the latest candidate even when the prior application still exists', () => {
  const rows = canonicalizeTpgRows([
    submission({
      'Date Submitted': '19-07-2026',
      'Application Ref. No.': 'TPG-2026119885',
      'Course Ref. No.': 'TGS-2024051414',
      'Submission Type': 'Renew',
      'Course Type': 'WSQ',
      Status: 'Approved',
    }),
    submission(),
  ], 'Submissions');
  const planned = buildRenewalPlan([course()], rows).rows[0];
  assert.equal(planned.priorApplicationFound, true);
  assert.equal(planned.operation, 'superseded-by-newer');
  assert.equal(planned.desired.renewalApplicationNo, 'TPG-2026122842');
});

test('writes NOT Found and clears stale date/status when no exact candidate exists', () => {
  const planned = buildRenewalPlan([course()], []).rows[0];
  assert.equal(planned.operation, 'not-found');
  assert.deepEqual(planned.desired, {
    actualRenewDate: null,
    renewalApplicationNo: 'NOT Found',
    renewedStatus: null,
  });
});

test('normalizes HTML entities, whitespace, and case for exact title matching', () => {
  assert.equal(normalizeTitle('  R&D&#x20; Security  '), normalizeTitle('r&amp;d security'));
});

test('same-date selection prefers Submissions, then the higher application number', () => {
  const submissions = canonicalizeTpgRows([
    submission({ 'Application Ref. No.': 'TPG-2026122841' }),
    submission({ 'Application Ref. No.': 'TPG-2026122843' }),
  ], 'Submissions');
  const rejected = canonicalizeTpgRows([
    submission({ 'Application Ref. No.': 'TPG-2026129999', Status: 'Rejected' }),
  ], 'Rejected Applications');
  const planned = buildRenewalPlan([course({ actual_renew_date: null, renewal_application_no: null, renewed_status: null })], [
    ...rejected,
    ...submissions,
  ]).rows[0];
  assert.equal(planned.desired.renewalApplicationNo, 'TPG-2026122843');
  assert.equal(planned.sourceTab, 'Submissions');
});

test('rejects ambiguous title-only matches across selected database courses', () => {
  const courses = [
    course(),
    course({
      id: 'course-2',
      course_code: 'TGS-OTHER',
      new_course_code: 'TGS-OTHER',
      actual_renew_date: null,
      renewal_application_no: null,
      renewed_status: null,
    }),
  ];
  const rows = canonicalizeTpgRows([submission()], 'Submissions');
  assert.throws(() => buildRenewalPlan(courses, rows), RenewalPlanError);
});

test('an exact ref safely disambiguates courses that share a title', () => {
  const courses = [
    course(),
    course({
      id: 'course-2',
      course_code: 'TGS-OTHER',
      new_course_code: 'TGS-OTHER',
      actual_renew_date: null,
      renewal_application_no: null,
      renewed_status: null,
    }),
  ];
  const rows = canonicalizeTpgRows([
    submission({ 'Course Ref. No.': 'TGS-2024051414' }),
    submission({
      'Application Ref. No.': 'TPG-2026122844',
      'Course Ref. No.': 'TGS-OTHER',
    }),
  ], 'Submissions');
  const planned = buildRenewalPlan(courses, rows);
  assert.equal(planned.rows.find((row) => row.id === 'course-1')?.desired.renewalApplicationNo, 'TPG-2026122842');
  assert.equal(planned.rows.find((row) => row.id === 'course-2')?.desired.renewalApplicationNo, 'TPG-2026122844');
});

test('rejects a renewal application already stored on multiple selected courses', () => {
  const courses = [
    course(),
    course({
      id: 'course-2',
      title: 'Different Course',
      course_code: 'TGS-OTHER',
      new_course_code: 'TGS-OTHER',
    }),
  ];
  assert.throws(() => buildRenewalPlan(courses, []), /stored on multiple selected database courses/);
});

test('refuses to replace a newer stored pair with an older recovered candidate', () => {
  const rows = canonicalizeTpgRows([
    submission({ 'Date Submitted': '18-06-2026' }),
  ], 'Submissions');
  assert.throws(() => buildRenewalPlan([course()], rows), /older than the stored pair/);
});

test('capture completeness requires explicit coverage or complete pagination evidence', () => {
  const complete = inspectCaptureDocument({
    submissions: { count: 1, rows: [submission()], pageAudit: [{ summary: '1 to 1 of 1 records' }] },
  }, 'Submissions');
  const partial = inspectCaptureDocument({ rows: [submission()] }, 'Submissions');
  assert.equal(complete.complete, true);
  assert.equal(partial.complete, false);
});

test('rejects a complete-coverage claim whose total disagrees with row count', () => {
  assert.throws(() => inspectCaptureDocument({
    coverage: { complete: true, total: 2 },
    rows: [submission()],
  }, 'Submissions'), /claims complete coverage/);
});

test('plan hashes are deterministic and detect tampering', () => {
  const unsigned = { schemaVersion: 1, rows: [{ id: 'a', desired: { status: 'Draft' } }] };
  const plan = { ...unsigned, planHash: computePlanHash(unsigned) };
  assert.equal(verifyPlanHash(plan), true);
  assert.equal(verifyPlanHash({ ...plan, rows: [] }), false);
});

test('planning is idempotent once the database already has the desired state', () => {
  const rows = canonicalizeTpgRows([submission()], 'Submissions');
  const current = course({
    actual_renew_date: '2026-09-18',
    renewal_application_no: 'TPG-2026122842',
    renewed_status: 'Draft',
  });
  const planned = buildRenewalPlan([current], rows).rows[0];
  assert.equal(planned.changed, false);
  assert.equal(planned.operation, 'already-current');
});
