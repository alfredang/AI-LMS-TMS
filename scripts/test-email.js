#!/usr/bin/env node
/**
 * scripts/test-email.js
 *
 * Sends a single test email using the Gmail OAuth credentials stored in
 * training_provider. Synchronous and verbose: any failure (token refresh,
 * Gmail API rejection, missing config) is printed in full so we know whether
 * Gmail itself works.
 *
 * Usage from inside the app container's shell:
 *   node scripts/test-email.js <recipient-email>
 *
 * Example:
 *   node scripts/test-email.js angch@tertiaryinfotech.com
 *
 * The script uses the same DB pool and Gmail flow as
 * pages/api/auth/send-otp.ts, so a success here means real Gmail sends work
 * end-to-end. A failure here points at exactly which step is broken.
 */

const { Pool } = require('pg');
const { google } = require('googleapis');

async function main() {
  const recipient = process.argv[2];
  if (!recipient || !recipient.includes('@')) {
    console.error('Usage: node scripts/test-email.js <recipient-email>');
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  console.log('=== Gmail OAuth diagnostic ===');
  console.log('Recipient:', recipient);

  const tpResult = await pool.query(
    `SELECT email_user, company_email, support_email, company_name, company_shortname,
            google_client_id, google_client_secret, google_refresh_token
       FROM training_provider
   ORDER BY id LIMIT 1`
  );

  if (tpResult.rows.length === 0) {
    console.error('FAIL: no training_provider row.');
    process.exit(1);
  }

  const tp = tpResult.rows[0];
  console.log('\n[1] Credential presence:');
  console.log('    email_user            :', tp.email_user || '(MISSING)');
  console.log('    company_email         :', tp.company_email || '(missing)');
  console.log('    support_email         :', tp.support_email || '(missing)');
  console.log('    google_client_id      :', tp.google_client_id ? `set (len ${tp.google_client_id.length})` : '(MISSING)');
  console.log('    google_client_secret  :', tp.google_client_secret ? `set (len ${tp.google_client_secret.length})` : '(MISSING)');
  console.log('    google_refresh_token  :', tp.google_refresh_token ? `set (len ${tp.google_refresh_token.length})` : '(MISSING)');

  if (!tp.email_user || !tp.google_client_id || !tp.google_client_secret || !tp.google_refresh_token) {
    console.error('\nFAIL: Gmail OAuth not fully configured. Missing fields above.');
    await pool.end();
    process.exit(1);
  }

  console.log('\n[2] Refreshing access token...');
  const oauth2Client = new google.auth.OAuth2(
    tp.google_client_id,
    tp.google_client_secret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: tp.google_refresh_token });

  let accessToken;
  try {
    const tok = await oauth2Client.getAccessToken();
    accessToken = tok && tok.token ? tok.token : tok;
    console.log('    OK — got access token (first 20 chars):', String(accessToken).slice(0, 20) + '...');
  } catch (e) {
    console.error('    FAIL — token refresh error:');
    console.error('      message:', e && e.message);
    console.error('      code   :', e && e.code);
    if (e && e.response && e.response.data) {
      console.error('      response.data:', JSON.stringify(e.response.data, null, 2));
    }
    console.error('\nLikely cause: refresh token revoked or expired.');
    console.error('Fix: regenerate refresh token via OAuth Playground and update training_provider.google_refresh_token.');
    await pool.end();
    process.exit(1);
  }

  console.log('\n[3] Sending test email via Gmail API...');
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const subject = `[TEST] Gmail diagnostic ${new Date().toISOString()}`;
  const bodyText = [
    'This is a diagnostic test email.',
    '',
    `Sent at: ${new Date().toISOString()}`,
    `From process: scripts/test-email.js`,
    `Sender (email_user): ${tp.email_user}`,
    '',
    'If you can read this, Gmail OAuth is working end-to-end on this server.',
  ].join('\n');

  const fromName = tp.company_shortname || tp.company_name || 'LMS';
  const replyTo = tp.support_email || tp.company_email || tp.email_user;

  const rawEmail = [
    `From: ${fromName} <${tp.email_user}>`,
    `Reply-To: ${replyTo}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const resp = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });
    console.log('    OK — Gmail accepted the message.');
    console.log('    messageId :', resp.data && resp.data.id);
    console.log('    threadId  :', resp.data && resp.data.threadId);
    console.log('    labelIds  :', resp.data && resp.data.labelIds);
    console.log('\nSUCCESS: Gmail OAuth and send pipeline are working.');
    console.log('Check the inbox (and Spam) of', recipient, 'for an email with subject:');
    console.log('   ', subject);
  } catch (e) {
    console.error('    FAIL — Gmail API error:');
    console.error('      message:', e && e.message);
    console.error('      code   :', e && e.code);
    if (e && e.response && e.response.data) {
      console.error('      response.data:', JSON.stringify(e.response.data, null, 2));
    }
    if (e && e.errors) {
      console.error('      errors :', JSON.stringify(e.errors, null, 2));
    }
    console.error('\nLikely causes:');
    console.error('  - Daily send quota exceeded (wait 24h, or check Gmail quota in Google Workspace admin)');
    console.error('  - Sender (email_user) does not have Send permission for this OAuth client');
    console.error('  - Gmail API not enabled on the GCP project');
    await pool.end();
    process.exit(1);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('UNEXPECTED ERROR:', e);
  process.exit(1);
});
