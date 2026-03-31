import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { google, drive_v3 } from 'googleapis';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';

// Disable body parser to handle multipart/form-data
export const config = {
    api: {
        bodyParser: false,
    },
};

/**
 * Authenticate using OAuth2.
 * Files will be uploaded directly as the `agenticai.tertiaryrobotics@gmail.com` user,
 * utilizing the account's 15GB free storage quota.
 */
function getDriveClient(): drive_v3.Drive {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google OAuth credentials. Ensure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN are set.');
    }

    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'http://localhost:9876'
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Find a subfolder by name inside a parent folder.
 * Includes a fallback to handle trailing spaces and case differences.
 */
async function findSubfolder(
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
async function findSessionFolderByStartDate(
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
async function createSubfolder(
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

/**
 * Get or create a subfolder for the student inside the parent folder.
 */
async function getOrCreateStudentFolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    studentName: string
): Promise<string> {
    const existing = await findSubfolder(drive, parentFolderId, studentName);
    if (existing) {
        console.log(`📁 Reusing existing Drive folder for "${studentName}": ${existing}`);
        return existing;
    }

    const newId = await createSubfolder(drive, parentFolderId, studentName);
    console.log(`📁 Created new Drive folder for "${studentName}": ${newId}`);
    return newId;
}

/**
 * Query the database for course run details using the course_run_id string.
 */
async function getCourseRunDetails(courseRunId: string) {
    const result = await pool.query(
        `SELECT cr.start_date, cr.end_date, cr.assigned_trainer_name,
                c.course_code, c.title as course_title,
                tp.common_name as trainer_common_name
         FROM course_run cr
         JOIN course c ON cr.course_id = c.id
         LEFT JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
         WHERE cr.id::text = $1 OR cr.course_run_id = $1
         LIMIT 1`,
        [courseRunId]
    );
    if (result.rows.length === 0) {
        return null;
    }
    return result.rows[0];
}

/**
 * Build the expected subfolder name inside Assessment Records.
 * Format: YYYY_MM_DD/DD_NAME
 * e.g., "2026_03_17/19_John Doe"
 */
function buildSessionFolderName(startDate: Date, endDate: Date, trainerName: string): string {
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
function buildStartDatePrefix(startDate: Date): string {
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const startDD = String(startDate.getDate()).padStart(2, '0');
    return `${yyyy}_${mm}_${startDD}`;
}

/**
 * Robust hierarchy builder:
 * Course Folder -> 'Assessment Records' -> Session Subfolder (matched by dates/trainer) -> Learner Folder
 */
async function ensureStudentUploadPath(
    drive: drive_v3.Drive,
    rootFolderId: string,
    courseCode: string,
    courseName: string,
    studentName: string,
    sessionFolderName: string | null,
    startDatePrefix: string | null,
    trainerCommonName?: string
): Promise<string> {
    // 1. Course Folder (Search by TGS Ref, create if missing)
    let courseFolderId = null;
    let tgsRef = courseCode;
    if (!tgsRef) {
        const tgsMatch = courseName.match(/(TGS-\d+)/);
        if (tgsMatch) {
            tgsRef = tgsMatch[1];
        }
    }

    const expectedCourseFolderName = tgsRef && courseName && !courseName.includes(tgsRef)
        ? `${tgsRef} ${courseName}`.trim()
        : (`${courseCode} ${courseName}`).trim() || 'Unknown Course';

    if (tgsRef) {
        const safeTgsRef = tgsRef.replace(/'/g, "\\'");
        const tgsResponse = await drive.files.list({
            q: `'${rootFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
            courseFolderId = tgsResponse.data.files[0].id!;
        }
    } else {
        courseFolderId = await findSubfolder(drive, rootFolderId, expectedCourseFolderName);
    }

    if (!courseFolderId) {
        courseFolderId = await createSubfolder(drive, rootFolderId, expectedCourseFolderName);
        console.log(`📁 Created new Course folder: ${expectedCourseFolderName}`);
    }

    // 2. Assessment Records Subfolder
    let assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
    if (!assessmentRecordsId) {
        assessmentRecordsId = await createSubfolder(drive, courseFolderId, 'Assessment Records');
        console.log(`📁 Created 'Assessment Records' inside Course folder`);
    }

    // 3. Session Subfolder (matched by start date + trainer common name)
    let targetParentId = assessmentRecordsId;
    if (startDatePrefix && sessionFolderName) {
        let sessionFolderId = await findSessionFolderByStartDate(drive, assessmentRecordsId, startDatePrefix, trainerCommonName);
        if (sessionFolderId) {
            console.log(`📁 Found existing session folder matching start date "${startDatePrefix}"${trainerCommonName ? ` + trainer "${trainerCommonName}"` : ''}: ${sessionFolderId}`);
        } else {
            sessionFolderId = await createSubfolder(drive, assessmentRecordsId, sessionFolderName);
            console.log(`📁 Created new session folder: ${sessionFolderName}`);
        }
        targetParentId = sessionFolderId;
    }

    // 4. Learner Folder (just the learner name, no date)
    const studentFolderId = await getOrCreateStudentFolder(drive, targetParentId, studentName);
    return studentFolderId;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    // Explicitly handle OPTIONS preflight (cors helper might return true or false depending on setup)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: `Method ${req.method} not allowed. Use POST for file uploads.` });
    }

    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!parentFolderId) {
        return res.status(500).json({
            success: false,
            error: 'GOOGLE_DRIVE_FOLDER_ID is not configured on the server.',
        });
    }

    const courseCode = (req.query.courseCode as string) || '';
    const courseName = (req.query.courseName as string) || '';
    const studentName = (req.query.studentName as string) || 'Unknown Student';
    const courseRunId = (req.query.courseRunId as string) || '';

    console.log('📤 Upload request received:');
    console.log(`   courseCode: "${courseCode}"`);
    console.log(`   courseName: "${courseName}"`);
    console.log(`   studentName: "${studentName}"`);
    console.log(`   courseRunId: "${courseRunId}"`);

    try {
        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: 100 * 1024 * 1024, // 100 MB limit
        });

        const { files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile || !uploadedFile.filepath) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const originalName = uploadedFile.originalFilename || 'untitled';
        const mimeType = uploadedFile.mimetype || 'application/octet-stream';

        const drive = getDriveClient();

        // Look up course run details from the database for folder matching
        let sessionFolderName: string | null = null;
        let startDatePrefix: string | null = null;
        let effectiveCourseCode = courseCode;
        let effectiveCourseName = courseName;
        let trainerCommonName = '';

        if (courseRunId) {
            const runDetails = await getCourseRunDetails(courseRunId);
            console.log(`🔍 DB lookup for courseRunId "${courseRunId}":`, runDetails ? 'FOUND' : 'NOT FOUND');
            if (runDetails) {
                const startDate = new Date(runDetails.start_date);
                const endDate = new Date(runDetails.end_date);
                // Prefer common_name for folder naming; fall back to assigned_trainer_name
                trainerCommonName = runDetails.trainer_common_name || '';
                const trainerName = trainerCommonName || runDetails.assigned_trainer_name || 'Unknown Trainer';
                sessionFolderName = buildSessionFolderName(startDate, endDate, trainerName);
                startDatePrefix = buildStartDatePrefix(startDate);
                console.log(`📋 Course Run ${courseRunId}: new session folder = "${sessionFolderName}", start date search = "${startDatePrefix}", common_name = "${trainerCommonName}"`);

                // Use DB values for course code/name if not provided
                if (!effectiveCourseCode && runDetails.course_code) {
                    effectiveCourseCode = runDetails.course_code;
                }
                if (!effectiveCourseName && runDetails.course_title) {
                    effectiveCourseName = runDetails.course_title;
                }
            } else {
                console.warn(`⚠️ Course Run ID '${courseRunId}' not found in database`);
            }
        } else {
            console.warn('⚠️ No courseRunId provided — folder will be placed directly in Assessment Records');
        }

        // Ensure the full path exists:
        // Course -> Assessment Records -> Session Folder (dates/trainer) -> Learner Name
        const studentFolderId = await ensureStudentUploadPath(
            drive, 
            parentFolderId, 
            effectiveCourseCode, 
            effectiveCourseName, 
            studentName,
            sessionFolderName,
            startDatePrefix,
            trainerCommonName
        );

        // 4. Upload file into the student's subfolder
        const driveResponse = await drive.files.create({
            requestBody: {
                name: originalName,
                parents: [studentFolderId],
            },
            media: {
                mimeType,
                body: fs.createReadStream(uploadedFile.filepath),
            },
            fields: 'id, name, webViewLink, webContentLink',
        });

        // Clean up temporary file
        try { fs.unlinkSync(uploadedFile.filepath); } catch { /* ignore */ }

        const driveFile = driveResponse.data;

        // Make the file viewable by anyone with the link
        await drive.permissions.create({
            fileId: driveFile.id!,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        // Fetch updated file metadata
        const updatedFile = await drive.files.get({
            fileId: driveFile.id!,
            fields: 'id, name, webViewLink, webContentLink',
        });

        console.log(`✅ Google Drive: "${originalName}" → folder "${studentName}" (${studentFolderId})`);

        return res.status(200).json({
            success: true,
            data: {
                fileId: updatedFile.data.id,
                fileName: updatedFile.data.name,
                fileUrl: updatedFile.data.webViewLink,
                downloadUrl: updatedFile.data.webContentLink,
                originalFilename: originalName,
                studentFolder: studentName,
                studentFolderId,
            },
        });
    } catch (error: any) {
        console.error('❌ Google Drive Upload Error:', error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Failed to upload file to Google Drive.',
        });
    }
}

export default handler;
