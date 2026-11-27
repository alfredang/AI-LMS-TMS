import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvaluationRecipients, splitEmails } from '../pages/api/external/auto-send-class-evaluation';

const CC = ['angch@tertiaryinfotech.com', 'tansc@tertiaryinfotech.com'];

test('trainer is To, the CC list is Cc', () => {
  assert.deepEqual(resolveEvaluationRecipients(['teegmpi1@gmail.com'], CC), {
    to: ['teegmpi1@gmail.com'], cc: CC, noTrainer: false,
  });
});

test('a trainer who is also on the CC list is not copied twice', () => {
  assert.deepEqual(resolveEvaluationRecipients(['ANGCH@tertiaryinfotech.com'], CC), {
    to: ['ANGCH@tertiaryinfotech.com'], cc: ['tansc@tertiaryinfotech.com'], noTrainer: false,
  });
});

test('no trainer: the CC list becomes To', () => {
  assert.deepEqual(resolveEvaluationRecipients([], CC), { to: CC, cc: [], noTrainer: true });
});

test('nobody to send to', () => {
  assert.equal(resolveEvaluationRecipients([], []), null);
});

test('splitEmails trims, splits on comma/semicolon/space and de-duplicates', () => {
  assert.deepEqual(splitEmails(' a@x.com, b@x.com;A@x.com  c@x.com ,'), ['a@x.com', 'b@x.com', 'c@x.com']);
  assert.deepEqual(splitEmails(null), []);
});
