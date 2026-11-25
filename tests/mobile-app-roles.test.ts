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

test('admin sign-in allows the academy admins, plus any added in the env', async () => {
  const { mobileAdminEmails } = await import('../lib/mobileGoogleSignIn');
  const before = process.env.MOBILE_ADMIN_GOOGLE_EMAILS;
  try {
    // An old env value that lists only the owner must not drop the other admins.
    process.env.MOBILE_ADMIN_GOOGLE_EMAILS = 'angch@tertiaryinfotech.com, Extra@Example.com ';
    const admins = mobileAdminEmails();
    for (const email of ['angch@tertiaryinfotech.com', 'danny@tertiaryinfotech.com',
      'deepa@tertiaryinfotech.com', 'angss@tertiaryinfotech.com', 'tansc@tertiaryinfotech.com', 'extra@example.com']) {
      assert.ok(admins.includes(email), email);
    }
    assert.equal(admins.filter((e) => e === 'angch@tertiaryinfotech.com').length, 1);
    assert.ok(!admins.includes('danny@gmail.com'));
  } finally {
    if (before === undefined) delete process.env.MOBILE_ADMIN_GOOGLE_EMAILS;
    else process.env.MOBILE_ADMIN_GOOGLE_EMAILS = before;
  }
});
