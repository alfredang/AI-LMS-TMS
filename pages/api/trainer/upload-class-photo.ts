import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { drive_v3 } from 'googleapis';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { getGoogleDriveFolderId } from '../../../lib/googleDriveFolder';
import {
    getDriveClient,
    findSubfolder,
    findSessionFolderByStartDate,
    createSubfolder,
    buildSessionFolderName,
    buildStartDatePrefix,
} from '../../../lib/google-drive/drive-helpers';

export const config = {
    api: {
        bodyParser: false,
    },
};

async function ensureSessionUploadPath(
    drive: drive_v3.Drive,
    rootFolderId: string,
    courseCode: string,
    courseName: string,
    sessionFolderName: string,
    startDatePrefix: string,
    trainerCommonName?: string
): Promise<string> {
    let courseFolderId: string | null = null;
    let tgsRef = courseCode;
    if (!tgsRef) {
        const tgsMatch = courseName.match(/(TGS-\d+)/);
        if (tgsMatch) tgsRef = tgsMatch[1];
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
    }

    let assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
    if (!assessmentRecordsId) {
        assessmentRecordsId = await createSubfolder(drive, courseFolderId, 'Assessment Records');
    }

    let sessionFolderId = await findSessionFolderByStartDate(drive, assessmentRecordsId, startDatePrefix, trainerCommonName);
    if (!sessionFolderId) {
        sessionFolderId = await createSubfolder(drive, assessmentRecordsId, sessionFolderName);
    }

    return sessionFolderId;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const parentFolderId = await getGoogleDriveFolderId();
    if (!parentFolderId) {
        return res.status(500).json({ success: false, error: 'Google Drive Root Folder ID is not configured. Set it in Company Setting → Integration → Google.' });
    }

    try {
        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: 50 * 1024 * 1024,
        });

        const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const courseRunId = fields.courseRunId?.[0] || fields.courseRunId;
        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile || !courseRunId) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const mimeType = uploadedFile.mimetype || '';
        if (!mimeType.startsWith('image/')) {
            return res.status(400).json({ success: false, error: 'Only image files are allowed' });
        }

        const runResult = await pool.query(
            `SELECT cr.start_date, cr.end_date, cr.assigned_trainer_name,
                    c.course_code, c.title as course_title,
                    tp.common_name as trainer_common_name
             FROM course_run cr
             JOIN course c ON cr.course_id = c.id
             LEFT JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
             WHERE cr.id::text = $1`,
            [courseRunId]
        );

        if (runResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Course run not found' });
        }

        const run = runResult.rows[0];
        const startDate = new Date(run.start_date);
        const endDate = new Date(run.end_date);
        const trainerName = run.trainer_common_name || run.assigned_trainer_name || 'Unknown Trainer';

        const sessionFolderName = buildSessionFolderName(startDate, endDate, trainerName);
        const startDatePrefix = buildStartDatePrefix(startDate);

        const drive = await getDriveClient();
        const sessionFolderId = await ensureSessionUploadPath(
            drive,
            parentFolderId,
            run.course_code,
            run.course_title,
            sessionFolderName,
            startDatePrefix,
            run.trainer_common_name
        );

        const ext = (uploadedFile.originalFilename?.match(/\.[^.]+$/)?.[0]) || '.jpg';
        const fallbackName = `Class_Photo_${startDatePrefix}_${trainerName.replace(/\s+/g, '_')}${ext}`;
        const originalName = uploadedFile.originalFilename || fallbackName;

        const driveResponse = await drive.files.create({
            requestBody: {
                name: originalName,
                parents: [sessionFolderId],
            },
            media: {
                mimeType,
                body: fs.createReadStream(uploadedFile.filepath),
            },
            fields: 'id, name, webViewLink',
        });

        try { fs.unlinkSync(uploadedFile.filepath); } catch {}

        await drive.permissions.create({
            fileId: driveResponse.data.id!,
            requestBody: { role: 'reader', type: 'anyone' },
        });

        return res.status(200).json({
            success: true,
            data: {
                fileId: driveResponse.data.id,
                fileUrl: driveResponse.data.webViewLink,
                fileName: driveResponse.data.name,
                sessionFolder: sessionFolderName,
            }
        });

    } catch (error: any) {
        console.error('❌ Class Photo Upload Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
