import path from 'path';
import { Readable } from 'stream';
import pool from '../db';
import { getDriveClient } from './drive-helpers';

function cleanFileName(fileName: string): string {
    return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function extractGoogleDriveFolderId(input: string): string {
    const trimmed = input.trim();

    const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch?.[1]) return folderMatch[1];

    return trimmed;
}

export function extractGoogleDriveFileId(input: string): string | null {
    const trimmed = input.trim();

    const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch?.[1]) return fileMatch[1];

    const openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (openMatch?.[1]) return openMatch[1];

    const ucMatch = trimmed.match(/\/uc\?export=view&id=([a-zA-Z0-9_-]+)/);
    if (ucMatch?.[1]) return ucMatch[1];

    return null;
}

export function buildGoogleDriveImageUrl(fileId: string): string {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

async function getTrainerProfileImageFolderId(): Promise<string> {
    const result = await pool.query(
        `SELECT trainer_profile_image_url
         FROM training_provider
         LIMIT 1`
    );

    const folderUrl = result.rows[0]?.trainer_profile_image_url;
    if (!folderUrl) {
        throw new Error('Trainer Profile Image Folder is not configured in Company Settings.');
    }

    return extractGoogleDriveFolderId(folderUrl);
}

export async function uploadProfileImageBufferToDrive(params: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    role?: string;
    userId?: string;
}) {
    const drive = await getDriveClient();
    const folderId = await getTrainerProfileImageFolderId();

    const safeOriginalName = cleanFileName(params.originalName || 'profile-image');
    const rolePrefix = (params.role || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
    const userPrefix = (params.userId || 'profile').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${rolePrefix}_${userPrefix}_${Date.now()}_${safeOriginalName}`;

    const createResponse = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [folderId],
        },
        media: {
            mimeType: params.mimeType,
            body: Readable.from(params.buffer),
        },
        fields: 'id, name, webViewLink',
    });

    const fileId = createResponse.data.id;
    if (!fileId) {
        throw new Error('Google Drive did not return a file ID for the uploaded profile image.');
    }

    await drive.permissions.create({
        fileId,
        requestBody: {
            role: 'reader',
            type: 'anyone',
        },
    });

    return {
        fileId,
        fileName: createResponse.data.name || fileName,
        fileUrl: buildGoogleDriveImageUrl(fileId),
        webViewLink: createResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    };
}

export async function deleteProfileImageFromDrive(fileUrl: string | null | undefined) {
    if (!fileUrl || !fileUrl.includes('drive.google.com')) return;

    const fileId = extractGoogleDriveFileId(fileUrl);
    if (!fileId) return;

    const drive = await getDriveClient();
    await drive.files.delete({ fileId });
}
