import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { validateAuth, encryptAuth, decryptAuth, validateModel, DEFAULT_OPENAI_MODEL } from '../../lib/ai/credentials';
import { generationConfig, runCodex, CodexLogin } from '../../lib/ai/codex';
import { documentImages } from '../../lib/ai/document';
import { PDFDocument } from 'pdf-lib';

const fixture = JSON.stringify({ auth_mode: 'chatgpt', tokens: {
  access_token: 'fixture-access', refresh_token: 'fixture-refresh', id_token: 'fixture-id', account_id: 'fixture-account',
} });
process.env.AI_OAUTH_ENCRYPTION_KEY = 'fixture-encryption-key-for-tests-only';
process.env.CODEX_BINARY = resolve('tests/ai/fixtures/codex.cjs');

test('OAuth is validated, encrypted randomly and bound to tenant', () => {
  const a = encryptAuth(validateAuth(fixture), 'tenant-a');
  assert.notEqual(a, encryptAuth(validateAuth(fixture), 'tenant-a'));
  assert.equal(decryptAuth(a, 'tenant-a'), validateAuth(fixture));
  assert.throws(() => decryptAuth(a, 'tenant-b'));
  assert.throws(() => decryptAuth(a.slice(0,-5)+'AAAAA', 'tenant-a'));
  assert.throws(() => validateAuth(JSON.stringify({ OPENAI_API_KEY: 'fixture-key' })));
  assert.throws(() => validateAuth('{"auth_mode":"chatgpt","tokens":{}}'));
});

test('requested model is exact; generation has no shell/app tools', () => {
  assert.equal(DEFAULT_OPENAI_MODEL, 'gpt-5.6-sol');
  assert.equal(validateModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.throws(() => validateModel('--model evil'));
  const config = generationConfig();
  assert.equal(config.web_search, 'disabled');
  assert.equal(config.project_doc_max_bytes, 0);
  for (const feature of ['shell_tool', 'plugins', 'apps', 'multi_agent']) assert.equal(config.features[feature], false);
  assert.equal(generationConfig(true).web_search, 'live');
});

test('generation parses completion, refreshes credentials and isolates environment', async () => {
  process.env.OPENAI_API_KEY = 'fixture-ambient-must-not-be-inherited';
  let refreshed = '';
  const result = await runCodex(fixture, DEFAULT_OPENAI_MODEL, { prompt: 'Return JSON' }, async auth => { refreshed = auth; });
  assert.equal(result.text, '{"ok":true}');
  assert.equal(JSON.parse(refreshed).tokens.refresh_token, 'fixture-refresh-rotated');
});

test('failed model preserves refreshed OAuth and does not fall back', async () => {
  let refreshed = '';
  await assert.rejects(runCodex(fixture, 'unavailable-model', { prompt: 'OK' }, async auth => { refreshed = auth; }), /could not generate with model unavailable-model/);
  assert.equal(JSON.parse(refreshed).tokens.refresh_token, 'fixture-refresh-rotated');
});

test('device flow uses official RPC and destroys temporary session', async () => {
  const login = await CodexLogin.create(() => {});
  const result = await login.rpc('account/login/start', { type: 'chatgptDeviceCode' });
  assert.equal(result.verificationUrl, 'https://auth.openai.com/codex/device');
  const dir = login.dir;
  await login.close();
  await assert.rejects(access(dir));
});

test('PDF vision renders every page and rejects oversized documents', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Learner supporting document fixture');
  pdf.addPage().drawText('Second page fixture');
  const images = await documentImages(Buffer.from(await pdf.save()), 'application/pdf');
  assert.equal(images.length, 2);
  assert(images.every(image => image.extension === 'jpg' && image.data[0] === 0xff));
  for (let i=0;i<11;i++) pdf.addPage();
  await assert.rejects(documentImages(Buffer.from(await pdf.save()), 'application/pdf'), /up to 12/);
});

test('every Claude SDK consumer imports the provider adapter', async () => {
  const files = ['lib/cw-audit.ts', 'lib/cw-evidence-agent.ts', 'lib/cw-slides.ts',
    'lib/cw-slides-v2/phase1_research.ts', 'lib/cw-slides-v2/phase2_content.ts',
    'pages/api/developer/cw-generate.ts', 'pages/api/developer/cw-generate-doc.ts',
    'pages/api/developer/cp-generate.ts', 'pages/api/developer/seo-generate.ts'];
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    assert(code.includes("import { query } from '@lib/ai/query'"), file);
    assert(!code.includes("import { query } from '@anthropic-ai/claude-agent-sdk'"), file);
  }
});

test('Claude OAuth binds PKCE to the caller and rejects replay', async () => {
  const { startClaudeLogin, finishClaudeLogin } = await import('../../lib/ai/claude-login');
  const login = startClaudeLogin('fixture-owner');
  const url = new URL(login.url);
  assert.equal(url.hostname, 'claude.com');
  assert.equal(url.searchParams.get('scope'), 'user:inference');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert(!url.searchParams.has('code_verifier'));
  await assert.rejects(finishClaudeLogin('other-owner', login.state, 'fixture-code'), /expired/);
  await assert.rejects(finishClaudeLogin('fixture-owner', login.state, 'fixture-code#wrong-state'), /invalid/);
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(input, 'https://platform.claude.com/v1/oauth/token');
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.state, login.state);
    assert.equal(payload.expires_in, 31536000);
    assert.equal(payload.code_verifier.length, 43);
    return new Response(JSON.stringify({ access_token: 'sk-ant-oat-fixture-only-not-a-real-token' }), { status: 200 });
  };
  try {
    assert.equal(await finishClaudeLogin('fixture-owner', login.state, 'fixture-code#' + login.state), 'sk-ant-oat-fixture-only-not-a-real-token');
    await assert.rejects(finishClaudeLogin('fixture-owner', login.state, 'fixture-code'), /expired/);
  } finally { global.fetch = originalFetch; }
});
