import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classMemberSql, REMOVED_FROM_CLASS_STATUSES } from '../lib/enrolment/classMembership';

// 2026-11-19: 18 of 32 learners vanished from Assessment Grading mid-class because their
// TPGateway enrolments were cancelled. Membership must rest on all three sources.

test('a cancelled TPGateway enrolment alone does not decide membership', () => {
  const sql = classMemberSql('e');
  assert.match(sql, /LOWER\(e\.enrolment_status\) = 'cancelled' AND \(/);
});

test('digital attendance keeps a cancelled learner in the class', () => {
  const sql = classMemberSql('e');
  assert.match(sql, /FROM course_attendance/);
  assert.match(sql, /is_present/);
});

test('self-registration (QR form and sign-in help form) keeps a cancelled learner in the class', () => {
  const sql = classMemberSql('e');
  assert.match(sql, /FROM enrolment_detail_request/);
  assert.match(sql, /FROM signin_help_request/);
});

test('only an explicit removal takes a learner off without exception', () => {
  assert.deepEqual(REMOVED_FROM_CLASS_STATUSES, ['admin removed', 'withdrawn']);
});

test('the alias is applied throughout and validated', () => {
  const sql = classMemberSql('en');
  assert.ok(!/\be\.enrolment_status/.test(sql));
  assert.match(sql, /en\.course_run_id/);
  assert.throws(() => classMemberSql('e; DROP'), /Invalid SQL alias/);
});
