import assert from 'node:assert/strict';
import test from 'node:test';
import { guardRenewalTrial, renewalConfiguration } from '../lib/tpg/renewalTrialRequest';

test('production renewal access requires explicit configuration, matching origin and interactive session', () => {
  const names = ['ENABLE_TPG_RENEWAL_TRIAL', 'ENABLE_TPG_RENEWAL_SYNC', 'TPG_RENEWAL_ORIGIN', 'TPG_RENEWAL_JOB_DIR'];
  const saved = names.map(name => process.env[name]);
  try {
    names.forEach(name => delete process.env[name]);
    assert.equal(renewalConfiguration().enabled, false);
    process.env.ENABLE_TPG_RENEWAL_SYNC = 'true';
    process.env.TPG_RENEWAL_ORIGIN = 'https://lms-tms.tertiaryinfotech.com';
    assert.equal(renewalConfiguration().enabled, false);
    process.env.TPG_RENEWAL_JOB_DIR = '/app/tpg-renewal-jobs';
    assert.equal(renewalConfiguration().enabled, true);
    let status = 0;
    const res = { status(code: number) { status = code; return this; }, json() {} };
    const check = (origin: string, user: unknown) => guardRenewalTrial({ headers: { origin }, authUser: user } as any, res as any);
    assert.equal(check('https://untrusted.example', { id: 'user' }), false);
    assert.equal(status, 403);
    assert.equal(check(process.env.TPG_RENEWAL_ORIGIN, { isService: true }), false);
    assert.equal(check(process.env.TPG_RENEWAL_ORIGIN, null), false);
    assert.equal(check(process.env.TPG_RENEWAL_ORIGIN, { id: 'user', isService: false }), true);
    process.env.TPG_RENEWAL_ORIGIN = 'http://untrusted.example';
    assert.equal(renewalConfiguration().enabled, false);
    process.env.ENABLE_TPG_RENEWAL_TRIAL = 'true';
    assert.equal(renewalConfiguration().origin, 'http://localhost:3000');
    assert.equal(check('http://localhost:3000', { id: 'user' }), true);
  } finally {
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
});
