import { Pool } from 'pg';
import { google, drive_v3, slides_v1 } from 'googleapis';

export interface GoogleCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

/**
 * Fetches Google OAuth credentials from the training_provider table.
 * This is the single source of truth for Google integrations.
 */
export async function getGoogleCredentials(pool: Pool): Promise<GoogleCredentials> {
    const result = await pool.query(`
        SELECT 
            google_client_id as "clientId",
            google_client_secret as "clientSecret",
            google_refresh_token as "refreshToken"
        FROM training_provider
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error('No training provider settings found in database.');
    }

    const { clientId, clientSecret, refreshToken } = result.rows[0];

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Google OAuth credentials are not fully configured in Company Settings. Please set Client ID, Client Secret, and Refresh Token under Google Integration.');
    }

    return { clientId, clientSecret, refreshToken };
}

// --- Service-account (domain-wide delegation) transport ----------------------
// Mirrors the Gmail SA transport in lib/gmailOauthSend.ts: a JWT client
// impersonating email_user. Permanent — survives sales@ password changes,
// which auto-revoke the OAuth refresh token (invalid_grant) and have twice
// taken down Drive uploads (incl. learner assessment submissions).
// Requires the SA's client ID to be granted the scope under Workspace Admin →
// Security → API controls → Domain-wide delegation; until then authorize()
// fails fast with unauthorized_client and we fall back to the OAuth token.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const PRESENTATIONS_SCOPE = 'https://www.googleapis.com/auth/presentations';

const cachedSaJwtByScope = new Map<string, InstanceType<typeof google.auth.JWT>>();
const saUnavailableUntilByScope = new Map<string, number>();
const SA_RETRY_MS = 60_000;

async function getServiceAccountJwt(pool: Pool, scopes: string[]): Promise<InstanceType<typeof google.auth.JWT> | null> {
    const key = scopes.join(' ');
    const cached = cachedSaJwtByScope.get(key);
    if (cached) return cached;
    if (Date.now() < (saUnavailableUntilByScope.get(key) || 0)) return null;
    try {
        const result = await pool.query(`SELECT email_user FROM training_provider LIMIT 1`);
        const subject = result.rows[0]?.email_user;
        if (!subject) throw new Error('email_user is not configured in Company Settings');
        const sa = await loadServiceAccountCredentials(pool);
        const jwt = new google.auth.JWT({
            email: sa.client_email,
            key: sa.private_key,
            scopes,
            subject,
        });
        await jwt.authorize();
        console.log(`[google-auth] Using service-account transport (${sa.client_email} impersonating ${subject}) for scopes: ${key}`);
        cachedSaJwtByScope.set(key, jwt);
        return jwt;
    } catch (e: any) {
        console.warn(`[google-auth] Service-account transport unavailable for scopes ${key} (${e?.message || e}); falling back to OAuth refresh token`);
        saUnavailableUntilByScope.set(key, Date.now() + SA_RETRY_MS);
        return null;
    }
}

/** Clears cached SA clients so a settings change / DWD grant applies without an app restart. */
export function invalidateGoogleAuthCache(): void {
    cachedSaJwtByScope.clear();
    saUnavailableUntilByScope.clear();
}

/**
 * Returns an authenticated Google Drive client using database credentials.
 * Prefers the service-account (domain-wide delegation) transport; falls back
 * to the OAuth refresh token when the SA lacks the Drive scope.
 */
export async function getGoogleDriveClient(pool: Pool): Promise<drive_v3.Drive> {
    const saJwt = await getServiceAccountJwt(pool, [DRIVE_SCOPE]);
    if (saJwt) return google.drive({ version: 'v3', auth: saJwt });

    const { clientId, clientSecret, refreshToken } = await getGoogleCredentials(pool);
    // Using OAuth Playground redirect URI as it is commonly used for token generation in this app
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Loads the raw service account JSON credentials uploaded via Company Settings.
 * The DB column (google_service_account_json) holds the relative URL path
 * (e.g. /uploads/training_provider/service_account/service-account.json).
 *
 * Resolution order (mirrors credentials-service.ts loadPemFromPath pattern):
 *   1. Filesystem read from public/ directory (fastest, works in Docker)
 *   2. HTTP fetch via NEXT_PUBLIC_BASE_URL + path (production)
 *   3. HTTP fetch via APP_URL + path
 *   4. HTTP fetch via localhost:PORT + path (local dev)
 */
export async function loadServiceAccountCredentials(dbPool: Pool): Promise<Record<string, any>> {
    const result = await dbPool.query(`
        SELECT google_service_account_json
        FROM training_provider
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        throw new Error('No training provider settings found in database.');
    }

    const relativeUrl = result.rows[0].google_service_account_json;
    if (!relativeUrl) {
        throw new Error('Google service account key file is not configured in Company Settings. Upload it under Google Integration → Service Account.');
    }

    const normalizedPath = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    const tried: string[] = [];

    // 1. Filesystem first (works in Docker where public/ is copied into the image)
    const path = await import('path');
    const fs = await import('fs');
    const absPath = path.join(process.cwd(), 'public', normalizedPath);
    try {
        if (fs.existsSync(absPath)) {
            const text = fs.readFileSync(absPath, 'utf8');
            const credentials = JSON.parse(text);
            console.log(`[google-auth] Service account loaded from file: ${absPath}`);
            return credentials;
        }
    } catch { /* fall through */ }
    tried.push(`file:${absPath}`);

    // 2. HTTP fetch (multiple base URLs, same pattern as credentials-service.ts)
    const appBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const port = process.env.PORT || '3000';
    const localhostUrl = `http://localhost:${port}`;

    const baseUrls: string[] = [];
    if (appBaseUrl) baseUrls.push(appBaseUrl);
    if (appUrl && !baseUrls.includes(appUrl)) baseUrls.push(appUrl);
    if (!baseUrls.includes(localhostUrl)) baseUrls.push(localhostUrl);

    for (const base of baseUrls) {
        const url = `${base}${normalizedPath}`;
        try {
            const res = await fetch(url);
            if (res.ok) {
                const text = await res.text();
                const credentials = JSON.parse(text);
                console.log(`[google-auth] Service account loaded via URL: ${url}`);
                return credentials;
            }
        } catch { /* try next */ }
        tried.push(url);
    }

    throw new Error(`Google service account key file could not be loaded from: ${normalizedPath}. Tried: ${tried.join(', ')}`);
}

/**
 * Returns a Google Auth client using a service account JSON file uploaded via Company Settings.
 */
export async function getServiceAccountAuth(dbPool: Pool, scopes: string[]) {
    const credentials = await loadServiceAccountCredentials(dbPool);
    return new google.auth.GoogleAuth({ credentials, scopes });
}

/**
 * Returns an authenticated Google Slides client using database credentials.
 * Prefers the service-account (domain-wide delegation) transport; falls back
 * to the OAuth refresh token when the SA lacks the Slides/Drive scopes.
 */
export async function getGoogleSlidesClient(pool: Pool): Promise<slides_v1.Slides> {
    const saJwt = await getServiceAccountJwt(pool, [PRESENTATIONS_SCOPE, DRIVE_SCOPE]);
    if (saJwt) return google.slides({ version: 'v1', auth: saJwt });

    const { clientId, clientSecret, refreshToken } = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.slides({ version: 'v1', auth: oauth2Client });
}
