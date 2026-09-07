import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchAcknowledgedTrainerTgs,
  tgsDateKey,
} from '../lib/calendar/trainerAcknowledgementRules';

const directory = [
  { name: 'Sivanesan Sivakaruniam', email: 'nesan1967@gmail.com' },
  { name: 'Kesston Tang', email: 'kesstontang@gmail.com' },
];

test('an accepted trainer acknowledges the same TGS and date', () => {
  const result = matchAcknowledgedTrainerTgs([
    {
      courseCode: ' tgs-2020505545 ',
      dateIso: '2026-09-10',
      name: 'Sivanesan Sivakaruniam',
      email: 'NESAN1967@GMAIL.COM',
      responseStatus: 'accepted',
    },
  ], directory);

  assert.equal(result.has(tgsDateKey('TGS-2020505545', '2026-09-10')), true);
  assert.equal(result.has(tgsDateKey('TGS-2020505545', '2026-09-11')), false);
});

test('one acceptance excludes every run ID sharing the TGS and date', () => {
  const result = matchAcknowledgedTrainerTgs([
    {
      courseCode: 'TGS-2022017524',
      dateIso: '2026-09-10',
      name: 'Kesston Tang',
      email: 'kesstontang@gmail.com',
      responseStatus: 'accepted',
    },
  ], directory);
  const runs = [
    { runId: '1361111', code: 'TGS-2022017524', date: '2026-09-10' },
    { runId: 'another-run', code: 'TGS-2022017524', date: '2026-09-10' },
    { runId: 'future-run', code: 'TGS-2022017524', date: '2026-09-11' },
  ];

  const remaining = runs.filter((run) => !result.has(tgsDateKey(run.code, run.date)));
  assert.deepEqual(remaining.map((run) => run.runId), ['future-run']);
});

test('pending, tentative and declined trainer responses remain reminder-eligible', () => {
  for (const responseStatus of ['needsAction', 'tentative', 'declined']) {
    const result = matchAcknowledgedTrainerTgs([
      {
        courseCode: 'TGS-2022017524',
        dateIso: '2026-09-10',
        name: 'Kesston Tang',
        email: 'kesstontang@gmail.com',
        responseStatus,
      },
    ], directory);
    assert.equal(result.size, 0);
  }
});

test('an exact trainer name can acknowledge when Calendar does not expose email', () => {
  const result = matchAcknowledgedTrainerTgs([
    {
      courseCode: 'TGS-2020505545',
      dateIso: '2026-09-10',
      name: '  Sivanesan   Sivakaruniam ',
      email: null,
      responseStatus: 'accepted',
    },
  ], directory);

  assert.equal(result.size, 1);
});

test('accepted learners and non-TGS courses do not trigger trainer exclusion', () => {
  const result = matchAcknowledgedTrainerTgs([
    {
      courseCode: 'TGS-2020505545',
      dateIso: '2026-09-10',
      name: 'Learner Example',
      email: 'learner@example.com',
      responseStatus: 'accepted',
    },
    {
      courseCode: 'C-123',
      dateIso: '2026-09-10',
      name: 'Sivanesan Sivakaruniam',
      email: 'nesan1967@gmail.com',
      responseStatus: 'accepted',
    },
  ], directory);

  assert.equal(result.size, 0);
});
