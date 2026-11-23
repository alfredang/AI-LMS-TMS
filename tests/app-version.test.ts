import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../pages/api/public/app-version';

test('compareVersions orders dotted numeric versions', () => {
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
  assert.equal(compareVersions('1.3', '1.3.0'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2', '1.99.99'), 1);
});
