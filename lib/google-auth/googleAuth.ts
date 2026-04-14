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

/**
 * Returns an authenticated Google Drive client using database credentials.
 */
export async function getGoogleDriveClient(pool: Pool): Promise<drive_v3.Drive> {
    const { clientId, clientSecret, refreshToken } = await getGoogleCredentials(pool);
    // Using OAuth Playground redirect URI as it is commonly used for token generation in this app
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Returns a Google Auth client using a service account JSON file uploaded via Company Settings.
 * The DB column (google_service_account_json) holds the relative URL path
 * (e.g. /uploads/training_provider/service_account/service-account.json).
 *
 * Resolution order (mirrors credentials-service.ts loadPemFromPath pattern):
 *   1. Filesystem read from public/ directory (fastest, works in Docker)
 *   2. HTTP fetch via NEXT_PUBLIC_BASE_URL + path (production)
 *   3. HTTP fetch via APP_URL + path
 *   4. HTTP fetch via localhost:PORT + path (local dev)
 */
export async function getServiceAccountAuth(dbPool: Pool, scopes: string[]) {
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
            return new google.auth.GoogleAuth({ credentials, scopes });
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
                return new google.auth.GoogleAuth({ credentials, scopes });
            }
        } catch { /* try next */ }
        tried.push(url);
    }

    throw new Error(`Google service account key file could not be loaded from: ${normalizedPath}. Tried: ${tried.join(', ')}`);
}

/**
 * Returns an authenticated Google Slides client using database credentials.
 */
export async function getGoogleSlidesClient(pool: Pool): Promise<slides_v1.Slides> {
    const { clientId, clientSecret, refreshToken } = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.slides({ version: 'v1', auth: oauth2Client });
}
