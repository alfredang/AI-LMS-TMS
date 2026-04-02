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
 * Returns an authenticated Google Slides client using database credentials.
 */
export async function getGoogleSlidesClient(pool: Pool): Promise<slides_v1.Slides> {
    const { clientId, clientSecret, refreshToken } = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.slides({ version: 'v1', auth: oauth2Client });
}
