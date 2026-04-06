export interface N8nWebhookResult {
  ok: boolean;
  statusCode: number;
  bodySnippet: string;
  error?: string;
}

const MAX_BODY_LOG = 2000;

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

    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
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
