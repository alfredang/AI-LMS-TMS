/**
 * Single client for the internal QuickBooks proxy (`POST /api/quickbooks/proxy`).
 *
 * Server-side code reaches QuickBooks by calling our own API route over HTTP
 * (loopback) rather than talking to Intuit directly, so token refresh and
 * rotation stay in one place. That route is guarded by `withAuth`, which means
 * these calls MUST present credentials — a server-side caller has no browser
 * session to borrow, so it authenticates as a machine caller with the
 * `x-api-key` service key (see lib/auth/serviceKey.ts; service callers bypass
 * role checks).
 *
 * This used to be copy-pasted into five modules, none of which sent a header.
 * When commit 50e5d79c (2026-08-04) put every API route behind `withAuth`, all
 * five started failing with a bare "Not authenticated" and every QuickBooks
 * write — CA invoices, DA invoices, customer create, void, SFC payment import —
 * silently stopped working. Keep this the ONLY implementation so an auth change
 * can never again fix four call sites and miss the fifth.
 */

export interface QbProxyResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

function proxyBaseUrl(): string {
  return (
    process.env.QBO_PROXY_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000'
  );
}

function serviceAuthHeaders(): Record<string, string> {
  // Same server-side keys isServiceRequest() accepts. NEXT_PUBLIC_* is never
  // used — those are compiled into the browser bundle.
  const key = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT || process.env.SCHEDULER_SECRET;
  return key ? { 'x-api-key': key } : {};
}

/**
 * POST to the QBO proxy and return the full envelope. Throws on a transport
 * error, a non-2xx, or `success: false`, using the proxy's own error text.
 */
export async function callQbProxy<T = any>(body: Record<string, any>): Promise<QbProxyResponse<T>> {
  const authHeaders = serviceAuthHeaders();
  if (Object.keys(authHeaders).length === 0) {
    // Fail with something actionable instead of the proxy's opaque
    // "Not authenticated", which reads like a QuickBooks problem.
    throw new Error(
      'QuickBooks proxy is unauthenticated: neither EXTERNAL_API_KEY_FOR_CLAWDBOT nor SCHEDULER_SECRET is set on the server. Set one in the deployment environment.'
    );
  }

  const resp = await fetch(`${proxyBaseUrl()}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  });

  const data = (await resp.json().catch(() => null)) as QbProxyResponse<T> | null;
  if (!resp.ok || !data?.success) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `QuickBooks proxy rejected the server's service key (${resp.status}). Check EXTERNAL_API_KEY_FOR_CLAWDBOT matches on this deployment.`
      );
    }
    console.error('[QBO proxy error details]', JSON.stringify(data, null, 2));
    throw new Error(data?.error || `QB proxy returned ${resp.status}`);
  }
  return data;
}

/** Same call, unwrapped to the `data` payload — for callers that only want it. */
export async function callQbProxyData<T = any>(body: Record<string, any>): Promise<T | undefined> {
  const resp = await callQbProxy<T>(body);
  return resp.data;
}
