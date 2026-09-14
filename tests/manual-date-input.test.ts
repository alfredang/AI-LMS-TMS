import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayDateToIso,
  formatManualDateInput,
  isoDateToDisplayValue,
} from '../lib/manualDateInput';

test('manual date typing is kept in dd/mm/yyyy format', () => {
  assert.equal(formatManualDateInput('0'), '0');
  assert.equal(formatManualDateInput('0908'), '09/08');
  assert.equal(formatManualDateInput('09/08/2026'), '09/08/2026');
  assert.equal(formatManualDateInput('09-08-2026123'), '09/08/2026');
});

test('valid display dates convert to ISO dates', () => {
  assert.equal(displayDateToIso('09/08/2026'), '2026-08-09');
  assert.equal(displayDateToIso('29/02/2028'), '2028-02-29');
  assert.equal(displayDateToIso(''), '');
});

test('incomplete and impossible display dates are rejected', () => {
  assert.equal(displayDateToIso('09/08/20'), null);
  assert.equal(displayDateToIso('31/02/2026'), null);
  assert.equal(displayDateToIso('29/02/2027'), null);
  assert.equal(displayDateToIso('08/09/0999'), null);
});

test('stored dates display as dd/mm/yyyy without a timezone shift', () => {
  assert.equal(isoDateToDisplayValue('2026-08-09'), '09/08/2026');
  assert.equal(isoDateToDisplayValue('2026-08-09T00:00:00.000Z'), '09/08/2026');
  assert.equal(isoDateToDisplayValue(null), '');
});
