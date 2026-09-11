import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export { DEFAULT_OPENAI_MODEL } from './models';
export const OPENAI_CREDENTIAL = 'lms:openai-oauth';

export function validateModel(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value)) {
    throw new Error('Enter a valid OpenAI model ID.');
  }
  return value;
}

export function validateAuth(raw: string): string {
  if (raw.length > 65536) throw new Error('OAuth credentials exceed the size limit.');
  const auth = JSON.parse(raw);
  if (auth.auth_mode !== 'chatgpt' || auth.OPENAI_API_KEY) throw new Error('Sign in with ChatGPT OAuth.');
  const tokens: Record<string, string> = {};
  for (const key of ['access_token', 'refresh_token', 'id_token', 'account_id']) {
    const value = auth.tokens?.[key];
    if (typeof value !== 'string' || !value || value.length > 20000 || /\s/.test(value)) {
      throw new Error('Incomplete OAuth credentials. Reconnect OpenAI.');
    }
    tokens[key] = value;
  }
  return JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens, last_refresh: auth.last_refresh });
}

function encryptionKey(): Buffer {
  const secret = process.env.AI_OAUTH_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Configure AI_OAUTH_ENCRYPTION_KEY with at least 32 characters on the server.');
  return createHash('sha256').update('lms-ai-oauth-v1\0').update(secret).digest();
}

export function encryptAuth(raw: string, tenant: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(tenant));
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
}

export function decryptAuth(value: string, tenant: string): string {
  const [iv, tag, encrypted] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(tenant));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
