import { randomUUID } from 'crypto';
import { CodexLogin } from './codex';
import { aiSettings, saveOpenAiAuth } from './settings';

type LoginState = { id: string; owner: string; tenant: string; state: 'starting' | 'pending' | 'connected' | 'error';
  verificationUrl?: string; userCode?: string; client?: CodexLogin; expiresAt: number; timer?: NodeJS.Timeout };
const globals = globalThis as typeof globalThis & { lmsOpenAiLogins?: Map<string, LoginState> };
const logins = globals.lmsOpenAiLogins ||= new Map<string, LoginState>();

export async function startLogin(owner: string) {
  const settings = await aiSettings();
  const tenant = settings.training_provider_id;
  for (const existing of logins.values()) {
    if (existing.tenant === tenant && ['starting', 'pending'].includes(existing.state)) {
      throw new Error('An OpenAI sign-in is already pending. Complete or cancel it before starting another.');
    }
  }
  const state: LoginState = { id: randomUUID(), owner, tenant, state: 'starting', expiresAt: Date.now() + 10 * 60 * 1000 };
  logins.set(state.id, state);
  try {
    const client = await CodexLogin.create(success => {
      void (async () => {
        if (state.state !== 'pending') return;
        try {
          if (!success) throw new Error('Sign-in failed');
          // Tenant identity must not change while a login is pending.
          if ((await aiSettings()).training_provider_id !== tenant) throw new Error('Training provider changed');
          await saveOpenAiAuth(await client.auth());
          state.state = 'connected';
        } catch { state.state = 'error'; }
        finally { await client.close(); }
      })();
    });
    state.client = client;
    state.state = 'pending';
    const reply = await client.rpc('account/login/start', { type: 'chatgptDeviceCode' });
    if (reply.type !== 'chatgptDeviceCode' || reply.verificationUrl !== 'https://auth.openai.com/codex/device') {
      throw new Error('Unexpected OpenAI sign-in response.');
    }
    state.verificationUrl = reply.verificationUrl;
    state.userCode = reply.userCode;
    state.timer = setTimeout(() => {
      logins.delete(state.id);
      void client.close();
    }, 10 * 60 * 1000);
    state.timer.unref();
    return publicLogin(state);
  } catch (error) {
    logins.delete(state.id);
    await state.client?.close();
    throw error;
  }
}
function publicLogin(state: LoginState) {
  return { id: state.id, state: state.state, verificationUrl: state.verificationUrl, userCode: state.userCode, expiresAt: state.expiresAt };
}
export function loginStatus(id: string, owner: string) {
  const state = logins.get(id);
  if (!state || state.owner !== owner || state.expiresAt < Date.now()) throw new Error('Sign-in expired or the server restarted. Start a new sign-in.');
  return publicLogin(state);
}
export async function cancelLogin(id: string, owner: string) {
  loginStatus(id, owner);
  const state = logins.get(id)!;
  state.state = 'error';
  clearTimeout(state.timer);
  logins.delete(id);
  await state.client?.close();
}
