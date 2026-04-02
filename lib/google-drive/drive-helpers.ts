/**
 * Shared Google Drive helper utilities.
 *
 * Provides OAuth2 Drive client creation, subfolder CRUD operations,
 * and session folder naming helpers used by both the upload flow
 * and the automated trainer-folder creation job.
 */

import { google, drive_v3 } from 'googleapis';
import { getGoogleDriveClient } from '../google-auth/googleAuth';
import pool from '../db';

// ── OAuth2 Drive Client ──────────────────────────────────────────────────────

/**
 * Authenticate using OAuth2.
 * Fetches credentials from the database (Company Settings) which is the source of truth.
 */
export async function getDriveClient(): Promise<drive_v3.Drive> {
    return getGoogleDriveClient(pool);
}

// ── Subfolder Helpers ────────────────────────────────────────────────────────

/**
 * Find a subfolder by name inside a parent folder.
 * Includes a fallback to handle trailing spaces and case differences.
 */
export async function findSubfolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    folderName: string
): Promise<string | null> {
    const safeName = folderName.replace(/'/g, "\\'");
    // Try exact match first
    let response = await drive.files.list({
        q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });

    if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
    }

    // Fallback: search all folders in parent to handle trailing spaces or case differences
    response = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 1000,
    });

    const files = response.data.files;
    if (files && files.length > 0) {
        const target = folderName.trim().toLowerCase();
        const matched = files.find(f => f.name && f.name.trim().toLowerCase() === target);
        if (matched) {
            return matched.id!;
        }
    }

    return null;
}

/**
 * Find a session subfolder by start date prefix inside a parent folder.
 * Matches any folder whose name starts with the start date (YYYY_MM_DD).
 * The end date and trainer name in the folder name are not required to match exactly.
 */
export async function findSessionFolderByStartDate(
    drive: drive_v3.Drive,
    parentFolderId: string,
    startDatePrefix: string,
    trainerCommonName?: string
): Promise<string | null> {
    const response = await drive.files.list({
        // Fetch all folders to check prefix manually since Drive API lacks a native startsWith operator
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });

    const files = response.data.files;
    if (files && files.length > 0) {
        // Try matching by start date + trainer common name first
        if (trainerCommonName) {
            const commonLower = trainerCommonName.trim().toLowerCase();
            const matched = files.find(f => {
                if (!f.name?.startsWith(startDatePrefix)) return false;
                // Check if the folder name contains the trainer's common name (case-insensitive)
                return f.name.toLowerCase().includes(commonLower);
            });
            if (matched) {
                console.log(`📁 Matched session folder by start date + common name "${trainerCommonName}": ${matched.name}`);
                return matched.id!;
            }
        }
        // Fallback: match by start date prefix only
        const matched = files.find(f => f.name?.startsWith(startDatePrefix));
        if (matched) return matched.id!;
    }
    return null;
}

/**
 * Create a subfolder inside a parent folder and return its ID.
 */
export async function createSubfolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    folderName: string
): Promise<string> {
    const response = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
        },
        fields: 'id',
    });

    return response.data.id!;
}

// ── Folder Name Builders ─────────────────────────────────────────────────────

/**
 * Build the expected subfolder name inside Assessment Records.
 * Format: YYYY_MM_DD/DD_NAME
 * e.g., "2026_03_17/19_John Doe"
 */
export function buildSessionFolderName(startDate: Date, endDate: Date, trainerName: string): string {
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const startDD = String(startDate.getDate()).padStart(2, '0');
    const endDD = String(endDate.getDate()).padStart(2, '0');
    return `${yyyy}_${mm}_${startDD}/${endDD}_${trainerName}`;
}

/**
 * Build the start date prefix for matching session folders.
 * Format: YYYY_MM_DD
 * e.g., "2026_03_17"
 * Only the start date is required to match — end date and trainer name are flexible.
 */
export function buildStartDatePrefix(startDate: Date): string {
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const startDD = String(startDate.getDate()).padStart(2, '0');
    return `${yyyy}_${mm}_${startDD}`;
}

/**
 * Find a course folder by TGS reference or name inside the root folder.
 */
export async function findCourseFolderByTgsRef(
    drive: drive_v3.Drive,
    rootFolderId: string,
    tgsRef: string | null,
    courseCode: string,
    courseName: string
): Promise<string | null> {
    if (tgsRef) {
        const safeTgsRef = tgsRef.replace(/'/g, "\\'");
        const tgsResponse = await drive.files.list({
            q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
            return tgsResponse.data.files[0].id!;
        }
    } else {
        const expectedName = (`${courseCode} ${courseName}`).trim() || 'Unknown Course';
        return findSubfolder(drive, rootFolderId, expectedName);
    }
    return null;
}
