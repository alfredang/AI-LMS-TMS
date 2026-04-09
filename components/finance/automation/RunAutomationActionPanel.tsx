import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { Icon, IconName } from '../../ui/Icon';

type ActionMeta = {
  id: string;
  menuLabel: string;
  kind: string;
  description: string;
  configured: boolean;
  /** DB key name (matches FINANCE_AUTOMATION_ACTIONS webhookEnvKey). */
  webhookEnvKey?: string;
  source?: 'db' | 'env' | 'missing' | 'built-in';
};

type WebhookUrlMeta = {
  actionId: string;
  kind: string;
  webhookEnvKey: string | null;
  url: string | null;
  source: 'db' | 'env' | 'missing' | 'not-applicable';
};

export default function RunAutomationActionPanel({
  actionId,
  fallbackLabel,
  fallbackDescription,
}: {
  actionId: string;
  fallbackLabel: string;
  fallbackDescription: string;
}) {
  const [actions, setActions] = useState<ActionMeta[] | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const [webhookMeta, setWebhookMeta] = useState<WebhookUrlMeta | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [showWebhook, setShowWebhook] = useState(false);
  const [runStatus, setRunStatus] = useState<
    | { state: 'idle' }
    | { state: 'running'; startedAt: number }
    | { state: 'done'; startedAt: number; endedAt: number; ok: boolean; statusCode?: number; bodySnippet?: string; error?: string }
  >({ state: 'idle' });
  const [history, setHistory] = useState<Array<{ startedAt: number; endedAt: number; ok: boolean; statusCode?: number; error?: string }>>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      try {
        const res = await fetch('/api/finance/automation/list');
        const json = await res.json();
        if (!cancelled && res.ok && Array.isArray(json.actions)) {
          setActions(json.actions);
        } else if (!cancelled) {
          setActions([]);
        }
      } catch {
        if (!cancelled) setActions([]);
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (runStatus.state !== 'running') {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    if (!tickRef.current) {
      tickRef.current = setInterval(() => setNow(Date.now()), 500);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [runStatus.state]);

  const meta = useMemo(() => {
    const found = actions?.find((a) => a.id === actionId);
    return found ?? null;
  }, [actions, actionId]);

  const label = meta?.menuLabel || fallbackLabel;
  const description = meta?.description || fallbackDescription;
  const configured = meta ? meta.configured : true;
  const kind = meta?.kind || 'n8n_webhook';

  const canRun = configured && kind === 'n8n_webhook';

  const fetchWebhook = async () => {
    if (kind !== 'n8n_webhook') return;
    setLoadingWebhook(true);
    try {
      const res = await fetch(`/api/finance/automation/webhook-url?actionId=${encodeURIComponent(actionId)}`);
      const json = (await res.json()) as WebhookUrlMeta & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load webhook URL');
      setWebhookMeta(json);
      setWebhookDraft(json.url || '');
    } catch (e) {
      setWebhookMeta(null);
      setWebhookDraft('');
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Failed to load webhook URL' });
    } finally {
      setLoadingWebhook(false);
    }
  };

  useEffect(() => {
    void fetchWebhook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId, kind]);

  const saveWebhook = async () => {
    if (kind !== 'n8n_webhook') return;
    const url = webhookDraft.trim();
    if (!url) {
      setToast({ variant: 'error', message: 'Webhook URL is required.' });
      return;
    }
    setSavingWebhook(true);
    try {
      const res = await fetch('/api/finance/automation/webhook-url', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save webhook URL');
      setToast({ variant: 'success', message: 'Webhook URL saved.' });
      await fetchWebhook();
      // also refresh meta list so configured badge matches
      try {
        const metaRes = await fetch('/api/finance/automation/list');
        const metaJson = await metaRes.json();
        if (metaRes.ok && Array.isArray(metaJson.actions)) setActions(metaJson.actions);
      } catch {
        // ignore
      }
    } catch (e) {
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Failed to save webhook URL' });
    } finally {
      setSavingWebhook(false);
    }
  };

  const run = async () => {
    if (!canRun) {
      setToast({
        variant: 'error',
        message: configured
          ? 'This action is not runnable from this page.'
          : 'This workflow is not configured on the server (missing webhook URL env var).',
      });
      return;
    }
    const startedAt = Date.now();
    setRunning(true);
    setRunStatus({ state: 'running', startedAt });
    try {
      const res = await fetch(`/api/finance/automation/${encodeURIComponent(actionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      const serverDurationMs = typeof json?.durationMs === 'number' ? Math.max(0, json.durationMs) : null;
      const endedAt = serverDurationMs !== null ? startedAt + serverDurationMs : Date.now();
      // If n8n responds extremely quickly, "Running" can be imperceptible.
      // Keep a tiny minimum so the user sees the live state.
      const minVisibleMs = 350;
      const elapsed = endedAt - startedAt;
      if (elapsed < minVisibleMs) {
        await new Promise((r) => setTimeout(r, minVisibleMs - elapsed));
      }
      setRunStatus({
        state: 'done',
        startedAt,
        endedAt: serverDurationMs !== null ? startedAt + serverDurationMs : Date.now(),
        ok: true,
        statusCode: typeof json?.statusCode === 'number' ? json.statusCode : res.status,
        bodySnippet: typeof json?.bodySnippet === 'string' ? json.bodySnippet : undefined,
      });
      setHistory((prev) => [{ startedAt, endedAt: serverDurationMs !== null ? startedAt + serverDurationMs : Date.now(), ok: true, statusCode: res.status }, ...prev].slice(0, 8));
      setToast({ variant: 'success', message: `${label}: request completed successfully.` });
    } catch (e) {
      const endedAt = Date.now();
      const minVisibleMs = 350;
      const elapsed = endedAt - startedAt;
      if (elapsed < minVisibleMs) {
        await new Promise((r) => setTimeout(r, minVisibleMs - elapsed));
      }
      const msg = e instanceof Error ? e.message : 'Workflow failed';
      setRunStatus({ state: 'done', startedAt, endedAt: Date.now(), ok: false, error: msg });
      setHistory((prev) => [{ startedAt, endedAt: Date.now(), ok: false, error: msg }, ...prev].slice(0, 8));
      setToast({ variant: 'error', message: msg });
    } finally {
      setRunning(false);
    }
  };

  const elapsedMs =
    runStatus.state === 'running'
      ? Math.max(0, now - runStatus.startedAt)
      : runStatus.state === 'done'
        ? Math.max(0, runStatus.endedAt - runStatus.startedAt)
        : 0;

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`rounded-lg px-4 py-3 text-sm shadow ${
            toast.variant === 'success' ? 'bg-green-800 text-white' : 'bg-red-800 text-white'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {kind === 'n8n_webhook' && (
        <div className="rounded-lg border border-default bg-surface-elevated px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-on-surface">Webhook URL</span>
              <span className="text-xs text-on-surface-secondary">
                {loadingWebhook ? 'Loading…' : webhookMeta?.source ? `Source: ${webhookMeta.source}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void fetchWebhook()}
                disabled={loadingWebhook || savingWebhook}
              >
                Refresh
              </Button>
              <Button onClick={() => void saveWebhook()} disabled={savingWebhook || loadingWebhook}>
                {savingWebhook ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>

          {webhookMeta?.webhookEnvKey && (
            <div className="text-xs text-on-surface-secondary">
              Key: <span className="font-mono text-on-surface">{webhookMeta.webhookEnvKey}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type={showWebhook ? 'text' : 'password'}
              value={webhookDraft}
              onChange={(e) => setWebhookDraft(e.target.value)}
              className="block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500"
              placeholder="https://n8n.../webhook/..."
              disabled={savingWebhook}
            />
            <button
              type="button"
              onClick={() => setShowWebhook((v) => !v)}
              className="p-2 rounded-md border border-gray-300 dark:border-gray-600 text-on-surface-secondary hover:text-on-surface"
              title={showWebhook ? 'Hide' : 'Show'}
            >
              <Icon name={showWebhook ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(webhookDraft.trim());
                  setToast({ variant: 'success', message: 'Copied.' });
                } catch {
                  setToast({ variant: 'error', message: 'Copy failed.' });
                }
              }}
              className="p-2 rounded-md border border-gray-300 dark:border-gray-600 text-on-surface-secondary hover:text-on-surface"
              title="Copy"
            >
              <Icon name={IconName.FileText} className="w-4 h-4" />
            </button>
          </div>

          <div className="text-xs text-on-surface-secondary">
            Updating this saves to the Training Provider database and affects the live site immediately (no redeploy).
          </div>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary" aria-hidden>
          <Icon name={IconName.Cloud} className="w-5 h-5 opacity-90" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface tracking-tight">{label}</p>
          <p className="text-xs text-on-surface-secondary mt-0.5">{description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {loadingMeta ? (
              <span className="text-on-surface-secondary">Checking configuration…</span>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    configured ? 'bg-green-900/30 text-green-300' : 'bg-amber-900/30 text-amber-200'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${configured ? 'bg-green-400' : 'bg-amber-300'}`} />
                  {configured ? 'Configured' : 'Not configured'}
                </span>
                <span className="text-on-surface-secondary">Type: {kind === 'n8n_webhook' ? 'n8n webhook' : kind}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Live run status */}
      <div className="rounded-lg border border-default bg-surface-elevated px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {runStatus.state === 'running' ? (
              <>
                <span className="inline-block h-3.5 w-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                <span className="text-sm font-semibold text-on-surface">Running</span>
                <span className="text-xs text-on-surface-secondary">for {formatElapsed(elapsedMs)}</span>
              </>
            ) : runStatus.state === 'done' ? (
              <>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${runStatus.ok ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
                  {runStatus.ok ? 'Done' : 'Failed'}
                </span>
                <span className="text-xs text-on-surface-secondary">in {formatElapsed(elapsedMs)}</span>
                {typeof runStatus.statusCode === 'number' && (
                  <span className="text-xs text-on-surface-secondary">HTTP {runStatus.statusCode}</span>
                )}
              </>
            ) : (
              <span className="text-sm text-on-surface-secondary">Idle</span>
            )}
          </div>
        </div>
        {runStatus.state === 'done' && !runStatus.ok && runStatus.error && (
          <div className="mt-2 text-xs text-red-300 break-words">{runStatus.error}</div>
        )}
        {runStatus.state === 'done' && runStatus.ok && runStatus.bodySnippet && (
          <div className="mt-2 text-xs text-on-surface-secondary break-words">
            Response: <span className="font-mono text-on-surface">{runStatus.bodySnippet}</span>
          </div>
        )}
      </div>

      {!configured && !loadingMeta && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-900/15 px-4 py-3 text-sm text-amber-200 space-y-2">
          <p>
            Production has no webhook URL for this action. Add the variable below to your hosting
            environment (e.g. Vercel → Project → Settings → Environment Variables → Production), then
            redeploy.
          </p>
          {meta?.webhookEnvKey && (
            <p className="font-mono text-xs bg-black/20 rounded px-2 py-1.5 break-all text-amber-100">
              {meta.webhookEnvKey}
            </p>
          )}
          <p className="text-xs text-amber-200/90">
            Set the webhook URL above and click <span className="font-semibold">Save</span>.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
          disabled={running}
        >
          Refresh
        </Button>
        <Button onClick={() => void run()} disabled={running || loadingMeta || !canRun}>
          {running ? (
            <>
              <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-2" />
              Running…
            </>
          ) : (
            'Run'
          )}
        </Button>
      </div>

      {history.length > 0 && (
        <div className="rounded-lg border border-default overflow-hidden">
          <div className="px-4 py-2 bg-surface-elevated text-xs font-semibold text-on-surface-secondary">
            Recent runs
          </div>
          <div className="divide-y divide-default">
            {history.map((h) => (
              <div key={h.startedAt} className="px-4 py-2 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-on-surface-secondary">
                    {new Date(h.startedAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-on-surface-secondary">
                    Duration: {formatElapsed(Math.max(0, h.endedAt - h.startedAt))}
                    {typeof h.statusCode === 'number' ? ` · HTTP ${h.statusCode}` : ''}
                  </div>
                </div>
                <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${h.ok ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
                  {h.ok ? 'DONE' : 'FAILED'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

