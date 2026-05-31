import pool from '../db';

// Resolution order for the QBO OAuth redirect URI:
//   1. DB column training_provider.qbo_oauth_redirect_uri (Company Setting)
//   2. process.env.QBO_REDIRECT_URI (Coolify fallback during cutover)
//   3. Computed from NEXT_PUBLIC_BASE_URL + /api/quickbooks/oauth/callback
//
// Whatever this returns must exactly match an entry in the QuickBooks
// Developer app's Redirect URIs allow list.

let cached: { value: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateQboRedirectCache(): void {
  cached = null;
}

export async function getQboRedirectUri(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let dbValue = '';
  try {
    const r = await pool.query(
      `SELECT qbo_oauth_redirect_uri FROM training_provider ORDER BY created_at DESC NULLS LAST LIMIT 1`
    );
    dbValue = (r.rows[0]?.qbo_oauth_redirect_uri || '').trim();
  } catch {
    // Column may not exist yet — fall through.
  }

  let value = dbValue;
  if (!value && process.env.QBO_REDIRECT_URI) value = process.env.QBO_REDIRECT_URI;
  if (!value) {
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    value = `${baseUrl}/api/quickbooks/oauth/callback`;
  }

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
