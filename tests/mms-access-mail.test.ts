import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('durable access mail uses one transport on uncertainty; the existing default fallback is preserved', async () => {
    const Module = require('node:module'); const original = Module._load;
    let smtpOn = true, smtpCalls = 0, gmailCalls = 0;
    Module._load = function (name: string, parent: any, ...rest: any[]) {
        const resolved = Module._resolveFilename(name, parent);
        if (resolved === path.resolve('lib/smtp.ts')) return { isSmtpEnabled: async () => smtpOn, sendViaSmtp: async () => { smtpCalls++; return { ok: false, uncertain: true, error: 'Uncertain SMTP timeout' }; } };
        if (resolved === path.resolve('lib/gmailOauthSend.ts')) return { sendViaGmailOAuth: async () => { gmailCalls++; return { ok: false, uncertain: true, error: 'Uncertain Gmail timeout' }; } };
        return original.call(this, name, parent, ...rest);
    };
    try {
        const { emailService } = require('../lib/services/emailService');
        const message = { to: 'fixture@example.com', subject: 'Fixture', text: 'Fixture' };
        const strict = await emailService.sendEmail({ ...message, avoidDuplicateRetry: true });
        assert.equal(strict.uncertain, true); assert.equal(smtpCalls, 1); assert.equal(gmailCalls, 0);
        smtpOn = false;
        await emailService.sendEmail({ ...message, avoidDuplicateRetry: true });
        assert.equal(smtpCalls, 1); assert.equal(gmailCalls, 1);
        // Normal callers, including funded-course callers, retain the original fallback behavior.
        await emailService.sendEmail(message);
        assert.equal(gmailCalls, 2); assert.equal(smtpCalls, 2);
    } finally { Module._load = original; }
});
