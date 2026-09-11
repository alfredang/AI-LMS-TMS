import { useEffect, useState } from 'react';
import Head from 'next/head';
import { DEFAULT_OPENAI_MODEL, CLAUDE_MODEL } from '@lib/ai/models';

type Settings = { provider: 'claude' | 'openai'; model: string; openaiConnected: boolean; claudeConnected: boolean; verifiedModel: string | null; claudeFallback: boolean };
type Login = { id: string; state: string; verificationUrl: string; userCode: string; expiresAt: number };
const inputClass = 'w-full rounded border border-slate-300 p-3 text-slate-900 bg-white';
const buttonClass = 'rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50';
export default function AiProviderPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<'claude' | 'openai'>('claude');
  const [model, setModel] = useState(DEFAULT_OPENAI_MODEL);
  const [token, setToken] = useState('');
  const [auth, setAuth] = useState('');
  const [fallback, setFallback] = useState(false);
  const [claudeLogin, setClaudeLogin] = useState<{ state: string; url: string } | null>(null);
  const [claudeCode, setClaudeCode] = useState('');
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function api(body?: object, query = '') {
    const response = await fetch('/api/ai/provider' + query, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Log in on the home page as an Admin or Training Provider, then return to this page.' : result.error);
    return result;
  }
  async function refresh(initial = false) {
    const result = await api(); setSettings(result);
    if (initial) { setProvider(result.provider); setModel(result.model); setFallback(result.claudeFallback); }
  }
  useEffect(() => { refresh(true).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!login || login.state !== 'pending') return;
    const timer = setInterval(() => {
      api(undefined, '?loginId=' + encodeURIComponent(login.id)).then(async result => {
        setLogin(result.login);
        if (result.login.state === 'connected') { setMessage('OpenAI connected. Test the model, then save your provider.'); await refresh(); }
        if (result.login.state === 'error') setError('OpenAI sign-in failed. Reconnect and try again.');
      }).catch(e => { setError(e.message); setLogin(null); });
    }, 3000);
    return () => clearInterval(timer);
  }, [login?.id, login?.state]);
  async function action(body: object, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api(body);
      if (result.login) setLogin(result.login);
      if (result.claudeLogin) setClaudeLogin(result.claudeLogin);
      setMessage(success); setClaudeCode(''); setToken(''); setAuth('');
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <>
    <Head><title>AI Provider | Tertiary LMS/TMS</title></Head>
    <main className="min-h-screen bg-slate-100 px-5 py-12 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl bg-white p-6 shadow-sm">
        <a className="text-blue-700 underline" href="/">← LMS/TMS home</a>
        <h1 className="text-2xl font-bold">AI Provider</h1>
        <p>Choose the provider for AI chat, draft and content generation, courseware, assessments, SEO, audits and supporting-document analysis.</p>
        <p className="rounded bg-slate-100 p-3">Active provider: <strong>{settings ? settings.provider === 'openai' ? `OpenAI OAuth · ${settings.model}` : `Claude OAuth · ${CLAUDE_MODEL}` : 'Loading…'}</strong></p>
        <label className="block font-medium">Provider
          <select aria-label="Provider" className={inputClass} value={provider} onChange={e => setProvider(e.target.value as 'claude' | 'openai')}>
            <option value="claude">Claude OAuth</option><option value="openai">OpenAI OAuth</option>
          </select>
        </label>
        {provider === 'claude' ? <div className="space-y-3">
          <p>{settings?.claudeConnected ? 'Claude credentials are configured.' : 'Add a Claude OAuth token below.'}</p>
          <label className="block font-medium">Claude OAuth token
            <input className={inputClass} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="sk-ant-oat…" />
          </label>
          <button className={buttonClass} disabled={busy || !settings || !token.trim()} onClick={() => action({ action: 'claude-token', token }, 'Claude OAuth token saved.')}>Save Claude token</button>
        </div> : <div className="space-y-4">
          <p>{settings?.openaiConnected ? 'OpenAI OAuth is connected.' : 'Connect your OpenAI account to get started.'}</p>
          <label className="block font-medium">OpenAI model
            <input aria-label="OpenAI model" className={inputClass} value={model} onChange={e => setModel(e.target.value)} />
          </label>
          <button className={buttonClass} disabled={busy || !settings || login?.state === 'pending'} onClick={() => action({ action: 'connect' }, 'Open the sign-in link and enter the one-time code.')}>Connect OpenAI OAuth</button>
          {login?.state === 'pending' && <div className="space-y-3 rounded border border-blue-300 bg-blue-50 p-4">
            <a className="font-medium text-blue-800 underline" href={login.verificationUrl} target="_blank" rel="noreferrer">Open OpenAI sign-in</a>
            <p>One-time code: <strong className="font-mono text-xl">{login.userCode}</strong></p>
            <p>Enable device-code login in your ChatGPT security settings if asked. This page will confirm when connected.</p>
            <button className="underline" disabled={busy} onClick={async () => { await action({ action: 'cancel', loginId: login.id }, 'Sign-in cancelled.'); setLogin(null); }}>Cancel sign-in</button>
          </div>}
          <details className="rounded border p-4">
            <summary className="cursor-pointer font-medium">Enter existing OpenAI OAuth credentials</summary>
            <p className="my-3 text-sm">Import the auth.json file created by a Codex ChatGPT sign-in, or paste its contents. It contains the OAuth access and refresh tokens. An OpenAI Platform API key is a different login type.</p>
            <input aria-label="OpenAI OAuth auth.json file" type="file" accept=".json,application/json" onChange={async e => {
              const file = e.target.files?.[0]; if (!file) return;
              if (file.size > 65536) { setError('Choose an auth.json file smaller than 64 KB.'); return; }
              setAuth(await file.text()); e.target.value = '';
            }} />
            <label className="mt-3 block">OAuth credentials
              <input aria-label="OpenAI OAuth credentials" className={inputClass} type="password" autoComplete="off" value={auth} onChange={e => setAuth(e.target.value)} placeholder="Paste auth.json contents" />
            </label>
            <button className={buttonClass + ' mt-3'} disabled={busy || !settings || !auth.trim()} onClick={() => action({ action: 'import', auth }, 'OAuth credentials saved. Test the model before switching.')}>Save OAuth credentials</button>
          </details>
          <button className={buttonClass} disabled={busy || !settings?.openaiConnected} onClick={() => action({ action: 'test', model }, `Connection test passed for ${model}.`)}>Test OpenAI connection</button>
          {settings?.verifiedModel && <p className="text-sm text-green-800">Last verified model: {settings.verifiedModel}</p>}
        </div>}
        <section className="space-y-3 rounded border border-slate-200 p-4">
          <h2 className="font-bold">Claude OAuth fallback and renewal</h2>
          <p className="text-sm">Claude model: <strong>{CLAUDE_MODEL}</strong></p>
          <p className="text-sm">When enabled, an OpenAI generation failure retries once through the Claude SDK. OpenAI connection tests still report their own failures.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={fallback} onChange={e => setFallback(e.target.checked)} />Use Claude OAuth when OpenAI fails</label>
          {provider === 'openai' && <label className="block">New Claude OAuth token
            <input className={inputClass} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="sk-ant-oat…" />
          </label>}
          {provider === 'openai' && <button className={buttonClass} disabled={busy || !settings || !token.trim()} onClick={() => action({ action: 'claude-token', token }, 'Claude OAuth fallback token saved.')}>Save Claude token</button>}
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} disabled={busy || !settings} onClick={() => action({ action: 'fallback', enabled: fallback }, 'Claude fallback setting saved.')}>Save fallback setting</button>
            <button className={buttonClass} disabled={busy || !settings} onClick={() => action({ action: 'claude-connect' }, 'Open the Claude sign-in link, then paste the authorization code below.')}>Sign in to Claude again</button>
          </div>
          <button className={buttonClass} disabled={busy || !settings?.claudeConnected} onClick={() => action({ action: 'test-claude' }, `Claude connection test passed for ${CLAUDE_MODEL}.`)}>Test Claude connection</button>
          {claudeLogin && <div className="space-y-3 rounded bg-blue-50 p-3">
            <a className="font-medium text-blue-800 underline" href={claudeLogin.url} target="_blank" rel="noreferrer">Open Claude sign-in</a>
            <p className="text-sm">After authorizing, copy the code shown by Claude and paste it here. The new token will be saved securely.</p>
            <label className="block">Claude authorization code
              <input className={inputClass} type="password" autoComplete="off" value={claudeCode} onChange={e => setClaudeCode(e.target.value)} />
            </label>
            <button className={buttonClass} disabled={busy || !claudeCode.trim()} onClick={async () => {
              await action({ action: 'claude-complete', state: claudeLogin.state, code: claudeCode }, 'New Claude OAuth token saved.');
              setClaudeLogin(null);
            }}>Complete Claude sign-in</button>
          </div>}
        </section>
        <div className="border-t pt-4">
          <button className={buttonClass} disabled={busy || !settings || (provider === 'openai' ? !settings.openaiConnected : !settings.claudeConnected)}
            onClick={() => action({ action: 'select', provider, model, claudeFallback: fallback }, `Active provider saved: ${provider === 'openai' ? 'OpenAI OAuth' : 'Claude OAuth'}.`)}>
            {busy ? 'Working…' : provider === 'openai' ? 'Test and use OpenAI OAuth' : 'Use Claude OAuth'}
          </button>
        </div>
        {message && <p role="status" className="rounded bg-green-50 p-3 text-green-900">{message}</p>}
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-900">{error}</p>}
        <p className="text-sm text-slate-600">Connecting or testing does not change the active provider. Saving OpenAI tests model access before switching. Saved credentials stay on the server. No email is sent by this page.</p>
      </div>
    </main>
  </>;
}
