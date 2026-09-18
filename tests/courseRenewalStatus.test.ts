import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRenewStatus,
  hasRenewalApplicationNo,
  isWithinRenewalWarningWindow,
  RENEW_STATUS_OPTIONS,
  RENEW_STATUS_VALUES,
} from '../lib/courseRenewalStatus';

const expectedStatuses = [
  'Others',
  'Pending Payment',
  'Processing',
  'Approved / Renewed',
  'Action Required',
  'Draft',
  'Pending Ack.',
  'Pending Sub.',
  'Rejected/Expired',
];

test('Renew Status dropdown exposes the approved labels and values in order', () => {
  assert.deepEqual(
    RENEW_STATUS_OPTIONS.map(option => option.label),
    expectedStatuses,
  );
  assert.deepEqual(
    RENEW_STATUS_OPTIONS.map(option => option.value),
    expectedStatuses,
  );
  expectedStatuses.forEach(status => assert.ok(RENEW_STATUS_VALUES.includes(status)));
});

test('Renew Status workflow classes distinguish in-progress and actionable states', () => {
  ['Pending Payment', 'Processing', 'Pending Ack.'].forEach(status => {
    assert.equal(classifyRenewStatus(status), 'Waiting');
  });
  ['Others', 'Action Required', 'Draft', 'Pending Sub.'].forEach(status => {
    assert.equal(classifyRenewStatus(status), 'ToDo');
  });
  assert.equal(classifyRenewStatus('Approved / Renewed'), 'Approved');
  assert.equal(classifyRenewStatus('Rejected/Expired'), 'Rejected');
});

test('renewal warnings require a real Renewal Application No', () => {
  [undefined, null, '', '   ', 'NOT Found', 'not found', ' Not Found '].forEach(value => {
    assert.equal(hasRenewalApplicationNo(value), false);
  });
  ['TPG-12345', 'APP 2026/001'].forEach(value => {
    assert.equal(hasRenewalApplicationNo(value), true);
  });
});

test('renewal warning windows exclude validity dates before today', () => {
  const today = new Date('2026-09-18T00:00:00');
  const windowEnd = new Date('2026-10-18T00:00:00');
  assert.equal(isWithinRenewalWarningWindow(new Date('2026-09-17T00:00:00'), today, windowEnd), false);
  assert.equal(isWithinRenewalWarningWindow(new Date('2026-09-18T00:00:00'), today, windowEnd), true);
  assert.equal(isWithinRenewalWarningWindow(new Date('2026-10-18T00:00:00'), today, windowEnd), true);
  assert.equal(isWithinRenewalWarningWindow(new Date('2026-10-19T00:00:00'), today, windowEnd), false);
  assert.equal(isWithinRenewalWarningWindow(null, today, windowEnd), false);
});
