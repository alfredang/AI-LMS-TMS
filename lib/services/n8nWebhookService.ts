import pool from '../db';

export interface N8nWebhookResult {
  ok: boolean;
  statusCode: number;
  bodySnippet: string;
  error?: string;
}

const MAX_BODY_LOG = 2000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000; // 10 minutes

// Cache the timeout for 60s to avoid hammering the DB on bursty triggers.
let cachedTimeoutMs: { value: number; expiresAt: number } | null = null;

export function invalidateN8nWebhookTimeoutCache(): void {
  cachedTimeoutMs = null;
}

async function getTimeoutMs(): Promise<number> {
  if (cachedTimeoutMs && cachedTimeoutMs.expiresAt > Date.now()) return cachedTimeoutMs.value;

  let dbValue = '';
  try {
    const r = await pool.query(
      `SELECT n8n_webhook_timeout_ms FROM training_provider ORDER BY created_at ASC NULLS LAST LIMIT 1`,
    );
    dbValue = String(r.rows[0]?.n8n_webhook_timeout_ms || '').trim();
  } catch {
    // Column may not exist yet — fall through to env / default.
  }

  const raw = dbValue || process.env.N8N_WEBHOOK_TIMEOUT_MS || '';
  const parsed = raw ? Number(raw) : NaN;
  const ms = Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
  // clamp between 5s and 30m
  const clamped = Math.min(30 * 60_000, Math.max(5_000, Math.floor(ms)));
  cachedTimeoutMs = { value: clamped, expiresAt: Date.now() + 60_000 };
  return clamped;
}

/**
 * POST (or GET) to an n8n webhook URL with JSON body for POST.
 */
export async function triggerN8nWebhook(
  url: string,
  options: { method?: 'POST' | 'GET'; body?: unknown } = {}
): Promise<N8nWebhookResult> {
  const method = options.method ?? 'POST';
  try {
    const init: RequestInit = {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    };
    if (method === 'POST' && options.body !== undefined) {
      init.body = JSON.stringify(options.body ?? { trigger: true });
    }

    const timeoutMs = await getTimeoutMs();
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const bodySnippet = text.length > MAX_BODY_LOG ? `${text.slice(0, MAX_BODY_LOG)}…` : text;

    if (!res.ok) {
      console.warn('[n8nWebhookService] Non-OK response', res.status, bodySnippet);
      return { ok: false, statusCode: res.status, bodySnippet, error: `HTTP ${res.status}` };
    }

    console.log('[n8nWebhookService] OK', res.status, bodySnippet.slice(0, 200));
    return { ok: true, statusCode: res.status, bodySnippet };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[n8nWebhookService] Request failed:', msg);
    return { ok: false, statusCode: 0, bodySnippet: '', error: msg };
  }
}
