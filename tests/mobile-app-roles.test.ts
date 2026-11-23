import test from 'node:test';
import assert from 'node:assert/strict';
import { appRoles } from '../lib/mobile/roles';

test('one email with several roles gets each app role, in display order', () => {
  assert.deepEqual(appRoles(['developer', 'Trainer', 'learner', 'admin']), ['learner', 'trainer', 'developer']);
  assert.deepEqual(appRoles(['trainer', 'developer']), ['trainer', 'developer']);
  assert.deepEqual(appRoles(['learner']), ['learner']);
});

test('the app still needs a learner or trainer role to sign in', () => {
  assert.deepEqual(appRoles(['developer']), []);
  assert.deepEqual(appRoles(['admin', 'developer']), []);
  assert.deepEqual(appRoles([]), []);
});
