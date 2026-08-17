import { withAuth, type AuthedApiRequest } from '@lib/auth/withAuth';
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
        return existing;
    }
    return await createSubfolder(drive, parentFolderId, studentName);
}

/**
 * Robust hierarchy builder matching learner upload flow
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
    // 1. Course Folder
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
    }

    // 2. Assessment Records Subfolder
    let assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
    if (!assessmentRecordsId) {
        assessmentRecordsId = await createSubfolder(drive, courseFolderId, 'Assessment Records');
    }

    // 3. Session Subfolder
    let targetParentId = assessmentRecordsId;
    if (startDatePrefix && sessionFolderName) {
        let sessionFolderId = await findSessionFolderByStartDate(drive, assessmentRecordsId, startDatePrefix, trainerCommonName);
        if (!sessionFolderId) {
            sessionFolderId = await createSubfolder(drive, assessmentRecordsId, sessionFolderName);
        }
        targetParentId = sessionFolderId;
    }

    // 4. Learner Folder
    return await getOrCreateStudentFolder(drive, targetParentId, studentName);
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
            maxFileSize: 50 * 1024 * 1024, // 50 MB
        });

        const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        let studentName = fields.studentName?.[0] || fields.studentName;
        const courseRunId = fields.courseRunId?.[0] || fields.courseRunId;

        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile || !studentName || !courseRunId) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Learners upload their own Assessment Summary Record from the course page,
        // so this route accepts the learner role — but studentName/courseRunId arrive
        // from the client. For a non-staff caller, ignore the submitted name and
        // resolve it from their own account, and only allow runs they are enrolled in.
        const authUser = (req as AuthedApiRequest).authUser;
        const isStaff = !!authUser?.isService
            || ['admin', 'trainingProvider', 'developer', 'trainer'].some(r => authUser?.roles.has(r));

        if (!isStaff) {
            const self = await pool.query(
                `SELECT au.full_name
                   FROM enrollment e
                   JOIN app_user au ON au.id = e.user_id
                  WHERE e.user_id = $1
                    AND e.course_run_id::text = $2
                    AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
                  LIMIT 1`,
                [authUser!.id, courseRunId]
            );
            if (self.rows.length === 0) {
                try { fs.unlinkSync(uploadedFile.filepath); } catch {}
                return res.status(403).json({ success: false, error: 'You are not enrolled in this class' });
            }
            // Use the account's name so learner and trainer uploads land in the same folder.
            studentName = self.rows[0].full_name;
        }

        // Fetch course run details
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
        const studentFolderId = await ensureStudentUploadPath(
            drive,
            parentFolderId,
            run.course_code,
            run.course_title,
            studentName,
            sessionFolderName,
            startDatePrefix,
            run.trainer_common_name
        );

        const originalName = uploadedFile.originalFilename || 'Assessment_Summary_Record.pdf';
        const mimeType = uploadedFile.mimetype || 'application/pdf';

        const driveResponse = await drive.files.create({
            requestBody: {
                name: originalName,
                parents: [studentFolderId],
            },
            media: {
                mimeType,
                body: fs.createReadStream(uploadedFile.filepath),
            },
            fields: 'id, name, webViewLink',
        });

        // Cleanup
        try { fs.unlinkSync(uploadedFile.filepath); } catch {}

        // Make readable by anyone
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
                studentFolder: studentName
            }
        });

    } catch (error: any) {
        console.error('❌ Summary Record Upload Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer', 'learner'] });
