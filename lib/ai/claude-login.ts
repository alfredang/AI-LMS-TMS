import { createHash, randomBytes } from 'crypto';

// Public-client setup-token contract from the installed Claude Agent SDK CLI.
// Inference-only, one-year token; PKCE verifier and state never leave the server.
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT = 'https://platform.claude.com/oauth/code/callback';
const globals = globalThis as typeof globalThis & { lmsClaudeLogins?: Map<string, { owner: string; verifier: string; expires: number }> };
const attempts = globals.lmsClaudeLogins ||= new Map();
export function startClaudeLogin(owner: string) {
  for (const [id, attempt] of attempts) if (attempt.expires < Date.now() || attempt.owner === owner) attempts.delete(id);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  attempts.set(state, { owner, verifier, expires: Date.now() + 10 * 60 * 1000 });
  const url = new URL('https://claude.com/cai/oauth/authorize');
  for (const [key, value] of Object.entries({ code: 'true', client_id: CLIENT_ID, response_type: 'code',
    redirect_uri: REDIRECT, scope: 'user:inference', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', state })) url.searchParams.set(key, value);
  return { state, url: url.toString() };
}
export async function finishClaudeLogin(owner: string, state: string, pasted: string): Promise<string> {
  const attempt = attempts.get(state);
  if (!attempt || attempt.owner !== owner || attempt.expires < Date.now()) throw new Error('Claude sign-in expired. Start again.');
  const [code, returnedState] = pasted.trim().split('#');
  if (!code || code.length > 4000 || /\s/.test(code) || (returnedState && returnedState !== state)) {
    throw new Error('Claude authorization code is invalid. Copy the code shown after sign-in.');
  }
  // Single-use before exchange, including a failed exchange.
  attempts.delete(state);
  const response = await fetch('https://platform.claude.com/v1/oauth/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'axios/1.8.4' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ grant_type: 'authorization_code', code, state, redirect_uri: REDIRECT,
      client_id: CLIENT_ID, code_verifier: attempt.verifier, expires_in: 31536000 }) });
  if (!response.ok) throw new Error('Claude sign-in failed. Start again and use a new authorization code.');
  const data = await response.json();
  if (typeof data.access_token !== 'string' || !/^sk-ant-oat[^\s]{20,20000}$/.test(data.access_token)) {
    throw new Error('Claude did not return a valid OAuth token.');
  }
  return data.access_token;
}
