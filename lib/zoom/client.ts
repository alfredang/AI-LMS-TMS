import pool from '../db';

const ZOOM_API_BASE_URL = 'https://api.zoom.us/v2';
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

export interface ZoomCredentials {
  trainingProviderId: string | number;
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
  accessToken: string | null;
  tokenExpiresAt: Date | null;
}

export interface ZoomUser {
  id?: string;
  account_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface ZoomMeetingResult {
  id: number | string;
  uuid?: string;
  topic?: string;
  join_url?: string;
  start_url?: string;
  password?: string;
  start_time?: string;
  duration?: number;
  timezone?: string;
}

export async function ensureZoomColumns(): Promise<void> {
  await pool.query(`
    ALTER TABLE training_provider
      ADD COLUMN IF NOT EXISTS zoom_oauth_client_id text,
      ADD COLUMN IF NOT EXISTS zoom_oauth_client_secret text,
      ADD COLUMN IF NOT EXISTS zoom_oauth_refresh_token text,
      ADD COLUMN IF NOT EXISTS zoom_oauth_access_token text,
      ADD COLUMN IF NOT EXISTS zoom_oauth_token_expires_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS zoom_account_id text,
      ADD COLUMN IF NOT EXISTS zoom_user_id text,
      ADD COLUMN IF NOT EXISTS zoom_user_email text,
      ADD COLUMN IF NOT EXISTS zoom_connected_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS zoom_enabled boolean DEFAULT false NOT NULL
  `);

  await pool.query(`
    ALTER TABLE course_run
      ADD COLUMN IF NOT EXISTS virtual_meeting_provider text,
      ADD COLUMN IF NOT EXISTS virtual_meeting_external_id text,
      ADD COLUMN IF NOT EXISTS virtual_meeting_host_link text,
      ADD COLUMN IF NOT EXISTS virtual_meeting_password text,
      ADD COLUMN IF NOT EXISTS virtual_meeting_status text,
      ADD COLUMN IF NOT EXISTS virtual_meeting_synced_at timestamp with time zone
  `);
}

// Resolution order: DB (Company Setting → Zoom) → env var → computed from
// NEXT_PUBLIC_BASE_URL. Whatever this returns must exactly match an entry
// in the Zoom Marketplace app's Redirect URL allow list.
export async function getZoomRedirectUri(): Promise<string> {
  try {
    const r = await pool.query(
      `SELECT zoom_oauth_redirect_uri FROM training_provider ORDER BY created_at DESC NULLS LAST LIMIT 1`
    );
    const dbValue = (r.rows[0]?.zoom_oauth_redirect_uri || '').trim();
    if (dbValue) return dbValue;
  } catch {
    // Column may not exist yet — fall through.
  }
  if (process.env.ZOOM_REDIRECT_URI) return process.env.ZOOM_REDIRECT_URI;
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ''
  ).replace(/\/$/, '');
  return `${baseUrl}/api/integrations/zoom/oauth/callback`;
}

export async function getZoomCredentials(): Promise<ZoomCredentials> {
  await ensureZoomColumns();
  const result = await pool.query(`
    SELECT
      id,
      zoom_oauth_client_id,
      zoom_oauth_client_secret,
      zoom_oauth_refresh_token,
      zoom_oauth_access_token,
      zoom_oauth_token_expires_at
    FROM training_provider
    ORDER BY created_at DESC NULLS LAST
    LIMIT 1
  `);

  const row = result.rows[0];
  if (!row) throw new Error('No training provider settings found.');

  const clientId = row.zoom_oauth_client_id || process.env.ZOOM_CLIENT_ID;
  const clientSecret = row.zoom_oauth_client_secret || process.env.ZOOM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Zoom OAuth client ID and client secret are not configured.');
  }

  return {
    trainingProviderId: row.id,
    clientId,
    clientSecret,
    refreshToken: row.zoom_oauth_refresh_token || process.env.ZOOM_REFRESH_TOKEN || null,
    accessToken: row.zoom_oauth_access_token || null,
    tokenExpiresAt: row.zoom_oauth_token_expires_at ? new Date(row.zoom_oauth_token_expires_at) : null,
  };
}

async function saveZoomToken(
  trainingProviderId: string | number,
  tokenData: { access_token?: string; refresh_token?: string; expires_in?: number }
): Promise<void> {
  const expiresIn = Number(tokenData.expires_in || 3600);
  const expiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000);

  await pool.query(
    `UPDATE training_provider
     SET zoom_oauth_access_token = COALESCE($1, zoom_oauth_access_token),
         zoom_oauth_refresh_token = COALESCE($2, zoom_oauth_refresh_token),
         zoom_oauth_token_expires_at = $3,
         zoom_enabled = true
     WHERE id = $4`,
    [tokenData.access_token || null, tokenData.refresh_token || null, expiresAt, trainingProviderId]
  );
}

export async function exchangeZoomAuthorizationCode(code: string): Promise<any> {
  const credentials = await getZoomCredentials();
  const redirectUri = await getZoomRedirectUri();
  if (!redirectUri.startsWith('http')) {
    throw new Error('Zoom redirect URI could not be resolved. Set it in Company Setting → Zoom or via NEXT_PUBLIC_BASE_URL / ZOOM_REDIRECT_URI.');
  }

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const text = await response.text();
  const tokenData = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(tokenData?.reason || tokenData?.message || `Zoom token exchange failed: ${response.status}`);
  }

  await saveZoomToken(credentials.trainingProviderId, tokenData);
  return tokenData;
}

export async function getZoomAccessToken(): Promise<string> {
  const credentials = await getZoomCredentials();
  const hasFreshToken =
    credentials.accessToken &&
    credentials.tokenExpiresAt &&
    credentials.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000;

  if (hasFreshToken) return credentials.accessToken!;
  if (!credentials.refreshToken) throw new Error('Zoom is not connected. Please connect Zoom first.');

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }).toString(),
  });

  const text = await response.text();
  const tokenData = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(tokenData?.reason || tokenData?.message || `Zoom token refresh failed: ${response.status}`);
  }

  await saveZoomToken(credentials.trainingProviderId, tokenData);
  if (!tokenData.access_token) throw new Error('Zoom token refresh did not return an access token.');
  return tokenData.access_token;
}

export async function zoomApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getZoomAccessToken();
  const response = await fetch(`${ZOOM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.message || data?.reason || `Zoom API ${response.status}`);
  }
  return data as T;
}

export async function getZoomCurrentUser(): Promise<ZoomUser> {
  return zoomApiRequest<ZoomUser>('/users/me');
}

export async function createZoomMeeting(payload: Record<string, unknown>): Promise<ZoomMeetingResult> {
  return zoomApiRequest<ZoomMeetingResult>('/users/me/meetings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveZoomConnectedUser(user: ZoomUser): Promise<void> {
  await ensureZoomColumns();
  await pool.query(
    `UPDATE training_provider
     SET zoom_account_id = $1,
         zoom_user_id = $2,
         zoom_user_email = $3,
         zoom_connected_at = NOW(),
         zoom_enabled = true
     WHERE id = (SELECT id FROM training_provider ORDER BY created_at DESC NULLS LAST LIMIT 1)`,
    [user.account_id || null, user.id || null, user.email || null]
  );
}
