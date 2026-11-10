import assert from 'node:assert/strict';
import test from 'node:test';
import { isLabsUnit, NOT_LABS_UNIT_SQL } from '../lib/courseLessonUnits';

test('isLabsUnit hides units titled only Lab or Labs', () => {
  for (const title of ['Labs', 'Lab', 'labs', 'LABS', '  Labs  ']) {
    assert.equal(isLabsUnit(title), true, title);
  }
});

test('isLabsUnit keeps real topics and mixed units', () => {
  for (const title of [
    'Topic 1: Claude Code Fundamentals',
    'Topic 38: Explore sensitivity labels',
    'Topic 3: Hands-on Labs',
    'Software & Labs',
    'Labs & Software',
    'Activities',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isLabsUnit(title), false, String(title));
  }
});

test('NOT_LABS_UNIT_SQL keeps the single backslashes Postgres needs', () => {
  assert.equal(NOT_LABS_UNIT_SQL, "lu.title !~* '^\\s*labs?\\s*$'");
});
