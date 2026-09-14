import { CLAUDE_MODEL } from './models';
import { runClaude } from './claude';
import pool from '../db';
import { AI_PROVIDER_SCHEMA } from './schema';
import { DEFAULT_OPENAI_MODEL, OPENAI_CREDENTIAL, decryptAuth, encryptAuth, validateModel, validateAuth } from './credentials';
import { runCodex, Generation } from './codex';

let schema: Promise<unknown> | undefined;
export async function aiSettings() {
  if (!schema) schema = pool.query(AI_PROVIDER_SCHEMA).catch(error => { schema = undefined; throw error; });
  await schema;
  const tenant = await pool.query('SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1');
  const id: string | undefined = tenant.rows[0]?.id;
  if (!id) throw new Error('No training provider is configured.');
  await pool.query('INSERT INTO training_provider_ai (training_provider_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  const result = await pool.query('SELECT * FROM training_provider_ai WHERE training_provider_id = $1', [id]);
  return result.rows[0] as { training_provider_id: string; provider: 'claude' | 'openai'; openai_model: string;
    oauth_encrypted: string | null; claude_encrypted: string | null; verified_model: string | null; claude_fallback: boolean };
}

export async function getGenerationCredential(): Promise<string | null> {
  const settings = await aiSettings();
  if (settings.provider === 'openai') return OPENAI_CREDENTIAL;
  return getClaudeCredential();
}

export async function getClaudeCredential(): Promise<string | null> {
  const settings = await aiSettings();
  if (settings.claude_encrypted) return decryptAuth(settings.claude_encrypted, settings.training_provider_id + ':claude');
  const result = await pool.query(`SELECT key_value FROM training_provider_api
    WHERE training_provider_id = $1 AND key_name = 'ANTHROPIC_API_KEY'`, [settings.training_provider_id]);
  return result.rows[0]?.key_value || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY || null;
}

/** Row locking serializes refresh-token rotation and connection replacement across workers. */
async function runOpenAi(input: Generation, testModel?: string, activate = false, fallback?: boolean): Promise<string> {
  const settings = await aiSettings();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '185s'");
    const result = await client.query('SELECT * FROM training_provider_ai WHERE training_provider_id = $1 FOR UPDATE', [settings.training_provider_id]);
    const current = result.rows[0];
    if (!current.oauth_encrypted) throw new Error('Connect OpenAI OAuth on the AI Provider page first.');
    const model = validateModel(testModel || current.openai_model || DEFAULT_OPENAI_MODEL);
    const output = await runCodex(decryptAuth(current.oauth_encrypted, settings.training_provider_id), model, input, async refreshed => {
      await client.query('UPDATE training_provider_ai SET oauth_encrypted = $2 WHERE training_provider_id = $1',
        [settings.training_provider_id, encryptAuth(refreshed, settings.training_provider_id)]);
    });
    if (testModel && output.text.trim() !== 'OK') throw new Error('OpenAI connection test returned an unexpected result. Provider was not changed.');
    await client.query(`UPDATE training_provider_ai SET oauth_encrypted = $2,
      openai_model = CASE WHEN $3 THEN $4 ELSE openai_model END,
      verified_model = CASE WHEN $3 THEN $4 ELSE verified_model END,
      provider = CASE WHEN $5 THEN 'openai' ELSE provider END,
      claude_fallback = CASE WHEN $5 THEN $6 ELSE claude_fallback END, updated_at = now()
      WHERE training_provider_id = $1`,
    [settings.training_provider_id, encryptAuth(output.auth, settings.training_provider_id), !!testModel, model, activate, !!fallback]);
    await client.query('COMMIT');
    return output.text;
  } catch (error) {
    // Keep a rotated refresh token even when model access/generation failed.
    await client.query('COMMIT').catch(() => {});
    throw error;
  }
  finally { client.release(); }
}

export async function saveOpenAiAuth(auth: string) {
  const settings = await aiSettings();
  const encrypted = encryptAuth(validateAuth(auth), settings.training_provider_id);
  await pool.query(`UPDATE training_provider_ai SET oauth_encrypted = $2, verified_model = NULL, updated_at = now()
    WHERE training_provider_id = $1`, [settings.training_provider_id, encrypted]);
}

export async function generateOpenAiResult(input: Generation, testModel?: string, activate = false, fallback?: boolean) {
  const settings = await aiSettings();
  try {
    const text = await runOpenAi(input, testModel, activate, fallback);
    return { text, provider: 'OPENAI_OAUTH', model: testModel || settings.openai_model, usedFallback: false };
  } catch (error) {
    if (testModel || !settings.claude_fallback) throw error;
    const token = await getClaudeCredential();
    if (!token) throw new Error('OpenAI failed and Claude fallback credentials are missing. Reconnect on the AI Provider page.');
    console.warn('[AI] OpenAI request failed; using the configured Claude SDK fallback.');
    const text = await runClaude(token, input);
    return { text, provider: 'CLAUDE_OAUTH', model: CLAUDE_MODEL, usedFallback: true };
  }
}
export async function generateOpenAi(input: Generation, testModel?: string, activate = false, fallback?: boolean): Promise<string> {
  return (await generateOpenAiResult(input, testModel, activate, fallback)).text;
}
export async function saveClaudeToken(token: string) {
  if (!/^sk-ant-oat[^\s]{20,20000}$/.test(token)) throw new Error('Enter a Claude OAuth token beginning sk-ant-oat.');
  const settings = await aiSettings();
  await pool.query('UPDATE training_provider_ai SET claude_encrypted = $2, updated_at = now() WHERE training_provider_id = $1',
    [settings.training_provider_id, encryptAuth(token, settings.training_provider_id + ':claude')]);
}
