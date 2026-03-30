import { NextApiRequest, NextApiResponse } from 'next';
import { google, drive_v3 } from 'googleapis';

/**
 * Verify whether a certificate file exists in Google Drive by its URL.
 * Extracts the file ID from a Drive URL and checks if the file is accessible.
 *
 * GET /api/certificates/verify-drive?url=https://drive.google.com/file/d/FILE_ID/view
 */

function getDriveClient(): drive_v3.Drive {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google OAuth credentials.');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
}

function extractFileId(url: string): string | null {
    // Match patterns like:
    //   https://drive.google.com/file/d/FILE_ID/view
    //   https://drive.google.com/open?id=FILE_ID
    const match = url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
    return match ? match[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const url = req.query.url as string;
    if (!url) {
        return res.status(400).json({ success: false, error: 'Missing required parameter: url' });
    }

    const fileId = extractFileId(url);
    if (!fileId) {
        return res.status(400).json({ success: false, error: 'Could not extract file ID from URL', exists: false });
    }

    try {
        const drive = getDriveClient();
        const file = await drive.files.get({
            fileId,
            fields: 'id, name, trashed, parents',
        });

        let inCertificatesFolder = false;
        
        // Ensure the file is inside a folder literally named "Certificates"
        if (file.data.parents && file.data.parents.length > 0) {
            try {
                const parent = await drive.files.get({
                    fileId: file.data.parents[0],
                    fields: 'id, name, trashed'
                });
                if (parent.data.name === 'Certificates' && !parent.data.trashed) {
                    inCertificatesFolder = true;
                }
            } catch (parentErr) {
                console.error(`Could not verify parent folder for cert ${fileId}:`, parentErr);
            }
        }

        const exists = !!file.data.id && !file.data.trashed && inCertificatesFolder;

        return res.status(200).json({
            success: true,
            exists,
            fileId,
            fileName: file.data.name,
            reason: (!exists && !file.data.trashed) ? 'File exists but is not in the Certificates folder' : undefined
        });
    } catch (error: any) {
        // 404 means the file doesn't exist or was permanently deleted
        if (error.code === 404) {
            return res.status(200).json({
                success: true,
                exists: false,
                fileId,
                reason: 'File not found in Google Drive',
            });
        }

        console.error('❌ Certificate Drive verification error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to verify certificate in Google Drive',
        });
    }
}
