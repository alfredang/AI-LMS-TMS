import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { google, drive_v3 } from 'googleapis';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

function getDriveClient(): drive_v3.Drive | null {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) return null;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
}

function extractFileId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { enrollmentId } = req.body;

    if (!enrollmentId || typeof enrollmentId !== 'string') {
        return res.status(400).json({ message: 'enrollmentId is required' });
    }

    try {
        // 1. Look up the current certificate URL before deleting
        const lookupRes = await pool.query(
            `SELECT certificate FROM enrollment WHERE id = $1`,
            [enrollmentId]
        );

        const certificateUrl = lookupRes.rows[0]?.certificate;

        // 2. Delete the actual file from Google Drive
        if (certificateUrl) {
            const fileId = extractFileId(certificateUrl);
            if (fileId) {
                const drive = getDriveClient();
                if (drive) {
                    try {
                        await drive.files.delete({ fileId });
                    } catch (driveErr: any) {
                        console.warn(`Could not delete Drive file ${fileId}:`, driveErr?.message);
                        // Continue even if Drive deletion fails (file may already be gone)
                    }
                }
            }
        }

        // 3. Clear the certificate URL from the enrollment record
        await pool.query(
            `UPDATE enrollment SET certificate = NULL, updated_at = NOW() WHERE id = $1`,
            [enrollmentId]
        );

        return res.status(200).json({ success: true, message: 'Certificate deleted from Google Drive and database.' });
    } catch (error: any) {
        console.error('Error deleting certificate:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
