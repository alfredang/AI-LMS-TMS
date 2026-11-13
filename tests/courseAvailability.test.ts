import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCourseAvailability, parseSsgDate } from '../lib/ssg/courseAvailabilityRules';

const base = {
  today: '2026-11-10',
  supportFrom: '2024-10-19',
  supportTo: '2027-10-18',
  hasFutureRun: true,
  renewedStatus: null,
};

test('active requires current SSG support and a future run', () => {
  assert.equal(classifyCourseAvailability(base).status, 'active');
  assert.equal(classifyCourseAvailability({ ...base, hasFutureRun: false }).status, 'no_public_run');
});

test('manual renewal status explains but never overrides SSG availability', () => {
  assert.equal(classifyCourseAvailability({
    ...base,
    supportTo: '2026-10-17',
    hasFutureRun: false,
    renewedStatus: 'Waiting For Renewal',
  }).status, 'renewal_processing');
  assert.equal(classifyCourseAvailability({
    ...base,
    supportTo: '2026-10-17',
    hasFutureRun: false,
    renewedStatus: 'Approved / Renewed',
  }).status, 'expired');
});

test('missing support and rejected renewals are explicit', () => {
  assert.equal(classifyCourseAvailability({ ...base, supportFrom: null, supportTo: null, hasFutureRun: false }).status, 'no_support');
  assert.equal(classifyCourseAvailability({ ...base, hasFutureRun: false, renewedStatus: 'Rejected / Expired' }).status, 'rejected');
});

test('SSG dates accept integer and ISO formats', () => {
  assert.equal(parseSsgDate(20261017), '2026-10-17');
  assert.equal(parseSsgDate('2026-10-17T00:00:00Z'), '2026-10-17');
  assert.equal(parseSsgDate('bad'), null);
});
