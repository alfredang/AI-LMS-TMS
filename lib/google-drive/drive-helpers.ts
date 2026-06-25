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

// ── Google File/Folder Sharing ───────────────────────────────────────────────

/**
 * Extract a Google Drive file or folder ID from various Google URL formats.
 * Supports:
 *   - Google Drive folders:  https://drive.google.com/drive/folders/FOLDER_ID
 *   - Google Drive files:    https://drive.google.com/file/d/FILE_ID/view
 *   - Google Slides:         https://docs.google.com/presentation/d/FILE_ID/edit
 *   - Google Docs:           https://docs.google.com/document/d/FILE_ID/edit
 *   - Google Sheets:         https://docs.google.com/spreadsheets/d/FILE_ID/edit
 *   - Google Drive open:     https://drive.google.com/open?id=FILE_ID
 */
export function extractGoogleFileId(url: string): string | null {
    if (!url) return null;

    // Pattern: /d/FILE_ID (Slides, Docs, Sheets, Drive file)
    const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (dMatch) return dMatch[1];

    // Pattern: /folders/FOLDER_ID
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];

    // Pattern: ?id=FILE_ID or &id=FILE_ID
    try {
        const parsed = new URL(url);
        const idParam = parsed.searchParams.get('id');
        if (idParam) return idParam;
    } catch {
        // Not a valid URL, skip
    }

    return null;
}

/**
 * Share a Google Drive file or folder with a user by email.
 * Grants read-only access. Non-blocking — errors are logged but not thrown.
 *
 * @param drive    - Authenticated Google Drive client
 * @param fileId   - Google Drive file/folder ID
 * @param email    - Email address to share with
 * @param label    - Human-readable label for logging (e.g. "trainer slides")
 */
export async function shareGoogleFileWithUser(
    drive: drive_v3.Drive,
    fileId: string,
    email: string,
    label: string = 'file'
): Promise<void> {
    try {
        await drive.permissions.create({
            fileId,
            sendNotificationEmail: false,
            requestBody: { role: 'reader', type: 'user', emailAddress: email },
        });
        console.log(`📂 Auto-shared ${label} with ${email}`);
    } catch (err: any) {
        if (err.message?.includes('already exists')) {
            console.log(`📂 ${email} already has access to ${label}.`);
        } else {
            console.warn(`⚠️ Could not share ${label} with ${email}: ${err.message}`);
        }
    }
}

/**
 * Auto-share all Google resource links from a course with a trainer email.
 * Fetches courseware_link and trainer_slides_url from the course table, extracts
 * file/folder IDs, and grants reader access for each.
 * Non-blocking — errors are logged but never thrown.
 */
export async function autoShareCourseResourcesWithTrainer(
    courseId: string,
    trainerEmail: string
): Promise<void> {
    try {
        const result = await pool.query(
            `SELECT courseware_link, trainer_slides_url
             FROM course
             WHERE id = $1`,
            [courseId]
        );

        if (result.rows.length === 0) return;

        const { courseware_link, trainer_slides_url } = result.rows[0];

        // Collect all Google links to share
        const linksToShare: { url: string; label: string }[] = [];

        if (courseware_link && courseware_link.includes('google.com')) {
            linksToShare.push({ url: courseware_link, label: 'courseware folder' });
        }
        if (trainer_slides_url && trainer_slides_url.includes('google.com')) {
            linksToShare.push({ url: trainer_slides_url, label: 'trainer slides' });
        }

        if (linksToShare.length === 0) return;

        // Find primary and secondary emails
        const emailsToShare = new Set<string>();
        if (trainerEmail) emailsToShare.add(trainerEmail.toLowerCase());

        try {
            const userResult = await pool.query(
                `SELECT email, secondary_email FROM app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1) LIMIT 1`,
                [trainerEmail]
            );
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                if (user.email) emailsToShare.add(user.email.toLowerCase());
                if (user.secondary_email) emailsToShare.add(user.secondary_email.toLowerCase());
            }
        } catch (e) {
            console.warn(`⚠️ Could not fetch secondary email for trainer sharing: ${(e as any).message}`);
        }

        // Authenticate once for all sharing operations
        const drive = await getDriveClient();

        for (const link of linksToShare) {
            const fileId = extractGoogleFileId(link.url);
            if (fileId) {
                for (const email of emailsToShare) {
                    await shareGoogleFileWithUser(drive, fileId, email, link.label);
                }
            } else {
                console.warn(`⚠️ Could not extract Google file ID from ${link.label} URL: ${link.url}`);
            }
        }
    } catch (error: any) {
        console.warn(`⚠️ Auto-share course resources error (non-blocking): ${error.message}`);
    }
}

/**
 * Set a Google Drive file to "Anyone with the link → Viewer". Unlike a per-email grant, this works
 * for ANY learner — including those who log into the LMS with a non-Google company email, or aren't
 * signed into Google at all — because access no longer depends on the viewer's account. Idempotent
 * + non-blocking. The org Google account (Company Settings OAuth) must own / be able to manage the
 * file, and its Workspace sharing policy must permit "anyone with link".
 */
export async function setGoogleFileLinkViewable(
    drive: drive_v3.Drive,
    fileId: string,
    label: string = 'file'
): Promise<void> {
    try {
        await drive.permissions.create({
            fileId,
            sendNotificationEmail: false,
            requestBody: { role: 'reader', type: 'anyone' },
        });
        console.log(`📂 ${label} set to anyone-with-link (viewer)`);
    } catch (err: any) {
        if (err.message?.includes('already exists')) {
            console.log(`📂 ${label} already link-viewable.`);
        } else {
            console.warn(`⚠️ Could not set ${label} link-sharing: ${err.message}`);
        }
    }
}

/**
 * Make a course run's LEARNER materials — learner slides, learner guide, lesson plan — viewable by
 * "anyone with the link". This is the access fix for learners who use a non-Google company email to
 * access the LMS (a per-email Drive grant can't reach them). Course-level + idempotent + non-blocking;
 * once set, current AND future learners can open the link regardless of their account.
 */
export async function autoShareLearnerMaterials(
    courseRunId: string
): Promise<{ files: number }> {
    const out = { files: 0 };
    try {
        const course = (await pool.query(
            `SELECT c.slides_url, c.learner_guide_url, c.lesson_plan_url
               FROM course_run cr JOIN course c ON c.id = cr.course_id
              WHERE cr.id::text = $1 OR cr.course_run_id = $1
              LIMIT 1`,
            [courseRunId]
        )).rows[0];
        if (!course) return out;

        const fileTargets = ([
            { url: course.slides_url, label: 'learner slides' },
            { url: course.learner_guide_url, label: 'learner guide' },
            { url: course.lesson_plan_url, label: 'lesson plan' },
        ] as { url: string | null; label: string }[])
            .filter(l => l.url && l.url.includes('google.com'))
            .map(l => ({ fileId: extractGoogleFileId(l.url!), label: l.label }))
            .filter((t): t is { fileId: string; label: string } => !!t.fileId);
        if (fileTargets.length === 0) return out;
        out.files = fileTargets.length;

        const drive = await getDriveClient();
        for (const t of fileTargets) {
            await setGoogleFileLinkViewable(drive, t.fileId, `${t.label} (learner)`);
        }
    } catch (error: any) {
        console.warn(`⚠️ autoShareLearnerMaterials error (non-blocking): ${error.message}`);
    }
    return out;
}

// ── In-Memory Folder Cache ───────────────────────────────────────────────────

/**
 * Cache to mitigate Google Drive Search API eventual consistency (index delay).
 * Format: Map<"parentFolderId::lower_case_folder_name", "folderId">
 */
const folderCache = new Map<string, string>();

function getCacheKey(parentId: string, name: string): string {
    return `${parentId}::${name.trim().toLowerCase()}`;
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
    const cacheKey = getCacheKey(parentFolderId, folderName);
    if (folderCache.has(cacheKey)) {
        return folderCache.get(cacheKey)!;
    }

    const safeName = folderName.replace(/'/g, "\\'");
    // Try exact match first
    let response = await drive.files.list({
        q: `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });

    if (response.data.files && response.data.files.length > 0) {
        const id = response.data.files[0].id!;
        folderCache.set(cacheKey, id);
        return id;
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
            const id = matched.id!;
            folderCache.set(cacheKey, id);
            return id;
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
                const id = matched.id!;
                folderCache.set(getCacheKey(parentFolderId, matched.name!), id);
                return id;
            }
        }
        // Fallback: match by start date prefix only
        const matched = files.find(f => f.name?.startsWith(startDatePrefix));
        if (matched) {
            const id = matched.id!;
            folderCache.set(getCacheKey(parentFolderId, matched.name!), id);
            return id;
        }
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

    const id = response.data.id!;
    folderCache.set(getCacheKey(parentFolderId, folderName), id);
    return id;
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
    const expectedName = tgsRef && courseName && !courseName.includes(tgsRef)
        ? `${tgsRef} ${courseName}`.trim()
        : (`${courseCode} ${courseName}`).trim() || 'Unknown Course';
        
    const cacheKey = getCacheKey(rootFolderId, expectedName);
    if (folderCache.has(cacheKey)) {
        return folderCache.get(cacheKey)!;
    }

    if (tgsRef) {
        const safeTgsRef = tgsRef.replace(/'/g, "\\'");
        const tgsResponse = await drive.files.list({
            q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
            const id = tgsResponse.data.files[0].id!;
            folderCache.set(cacheKey, id);
            return id;
        }
    } else {
        return findSubfolder(drive, rootFolderId, expectedName);
    }
    return null;
}
