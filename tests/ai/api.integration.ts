// Run only against the isolated fixture database/server described in docs/ai-provider.md.
import assert from 'node:assert/strict';
import { Client } from 'pg';

const base = process.env.AI_TEST_BASE_URL;
const database = process.env.AI_TEST_DATABASE_URL;
if (base !== 'http://localhost:3003' || !database || !/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/postgres$/.test(database)) {
  throw new Error('Set AI_TEST_BASE_URL=http://localhost:3003 and AI_TEST_DATABASE_URL to the throwaway local database.');
}
const fixture = JSON.stringify({ auth_mode: 'chatgpt', tokens: {
  access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: 'fixture-id', account_id: 'fixture-account',
} });
const client = new Client({ connectionString: database });
async function api(body?: object, token = 'lms_fixture_admin_only', path = '/api/ai/provider') {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
async function main() {
  await client.connect();
  assert.equal((await api(undefined, '')).status, 401);
  assert.equal((await api(undefined, 'lms_fixture_learner_only')).status, 403);
  assert.equal((await api({ action: 'select', provider: 'openai', model: 'gpt-5.6-sol' }, 'lms_fixture_learner_only')).status, 403);
  let result = await api();
  assert.equal(result.status, 200);
  assert.equal(result.data.provider, 'claude');
  assert.equal((await api({ action: 'import', auth: '{"OPENAI_API_KEY":"fixture"}' })).status, 400);
  assert.equal((await api({ action: 'import', auth: fixture })).status, 200);
  assert.equal((await api()).data.provider, 'claude');
  const failed = await api({ action: 'select', provider: 'openai', model: 'unavailable-model' });
  assert.equal(failed.status, 400);
  assert.equal((await api()).data.provider, 'claude');
  assert.equal((await api({ action: 'test', model: 'gpt-5.6-sol' })).status, 200);
  assert.equal((await api()).data.provider, 'claude');
  assert.equal((await api({ action: 'select', provider: 'openai', model: 'gpt-5.6-sol' })).status, 200);
  result = await api();
  assert.equal(result.data.provider, 'openai');
  assert.equal(result.data.model, 'gpt-5.6-sol');
  assert(!JSON.stringify(result.data).includes('fixture-access'));
  const chat = await api({ messages: [{ role: 'user', content: 'Reply OK' }] }, 'lms_fixture_admin_only', '/api/ai/chat');
  assert.equal(chat.status, 200);
  assert.equal(chat.data.provider, 'OPENAI_OAUTH');
  assert.equal(chat.data.text, 'OK');
  const config = await api(undefined, 'lms_fixture_admin_only', '/api/config/ai-provider');
  assert.equal(config.data.defaultProvider.provider, 'OPENAI_OAUTH');
  assert(!JSON.stringify(config.data).includes('apiKey'));
  await client.query("UPDATE training_provider_ai SET openai_model = 'unavailable-model'");
  const noFallback = await api({ messages: [{ role: 'user', content: 'Reply OK' }] }, 'lms_fixture_admin_only', '/api/ai/chat');
  assert.equal(noFallback.status, 502);
  assert.equal(noFallback.data.providerLocked, true);
  await client.query("UPDATE training_provider_ai SET openai_model = 'gpt-5.6-sol'");
  const encrypted = await client.query('SELECT oauth_encrypted FROM training_provider_ai');
  assert(!encrypted.rows[0].oauth_encrypted.includes('fixture'));
  assert.equal((await api({ action: 'select', provider: 'claude' })).status, 200);
  const start = await api({ action: 'connect' });
  assert.equal(start.status, 200);
  assert.equal(start.data.login.verificationUrl, 'https://auth.openai.com/codex/device');
  assert.equal((await api({ action: 'connect' })).status, 400);
  assert.equal((await api({ action: 'cancel', loginId: start.data.login.id })).status, 200);
  console.log('PASS: authorization, credential validation/encryption, failed-switch preservation, SDK generation, provider metadata, no fallback, device sign-in/cancel.');
}
main().finally(() => client.end()).catch(error => { console.error(error); process.exitCode = 1; });
