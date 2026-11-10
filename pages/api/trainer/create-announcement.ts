import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { ensureCourseAnnouncementTable } from '../../../lib/course-announcement-ensure-table';
import { getGoogleDriveFolderId } from '../../../lib/googleDriveFolder';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { ensureSessionAssessmentFolder } from '../../../lib/google-drive/assessmentRecordFolder';
import { getDocumentStorageProvider } from '../../../lib/documentStorage';

export const config = {
    api: {
        bodyParser: false,
    },
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function firstString(value: unknown): string | undefined {
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/**
 * Upload an announcement attachment into the class's Assessment Records
 * session folder on Google Drive (same folder as the class photos), shared
 * view-only by link so learners can open it. Returns null when Drive is not
 * configured or the upload fails; documents are never kept on the app server.
 */
async function uploadToClassDriveFolder(
    dbCourseRunId: string,
    filePath: string,
    fileName: string,
    mimeType: string,
): Promise<{ fileId: string; webViewLink: string } | null> {
    try {
        const rootFolderId = await getGoogleDriveFolderId();
        if (!rootFolderId) return null;

        const runRes = await pool.query(
            `SELECT cr.start_date, cr.end_date, cr.assigned_trainer_name,
                    c.course_code, c.title AS course_title,
                    tp.common_name AS trainer_common_name
               FROM course_run cr
               JOIN course c ON cr.course_id = c.id
               LEFT JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
              WHERE cr.id = $1`,
            [dbCourseRunId]
        );
        if (runRes.rows.length === 0) return null;
        const run = runRes.rows[0];

        const drive = await getDriveClient();
        const folderId = await ensureSessionAssessmentFolder(drive, rootFolderId, {
            courseCode: run.course_code,
            courseTitle: run.course_title,
            startDate: run.start_date,
            endDate: run.end_date,
            trainerName: run.trainer_common_name || run.assigned_trainer_name || 'Unknown Trainer',
            trainerCommonName: run.trainer_common_name,
        });

        const created = await drive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media: { mimeType: mimeType || 'application/octet-stream', body: fs.createReadStream(filePath) },
            fields: 'id, webViewLink',
        });
        const fileId = created.data.id;
        if (!fileId || !created.data.webViewLink) return null;

        await drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' },
        });

        return { fileId, webViewLink: created.data.webViewLink };
    } catch (err: any) {
        console.error('[Announcements] Google Drive upload failed:', err?.message ?? err);
        return null;
    }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        await ensureCourseAnnouncementTable();

        const form = new IncomingForm({
            keepExtensions: true,
            maxFileSize: 50 * 1024 * 1024,
            allowEmptyFiles: false,
        });

        const [fields, files] = await form.parse(req);

        const courseRunId = firstString(fields.courseRunId);
        const postedBy = firstString(fields.postedBy);
        const title = firstString(fields.title)?.trim() || null;
        const message = firstString(fields.message)?.trim() || null;
        const linkUrl = firstString(fields.linkUrl)?.trim() || null;

        if (!courseRunId || !postedBy) {
            return res.status(400).json({ success: false, error: 'Missing courseRunId or postedBy' });
        }

        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const hasFile = !!file && !!file.originalFilename;

        if (!message && !linkUrl && !hasFile) {
            return res.status(400).json({ success: false, error: 'Announcement must have a message, link, or file' });
        }

        let dbCourseRunId: string = courseRunId;
        if (!UUID_RE.test(courseRunId)) {
            const runRes = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [courseRunId]);
            if (runRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Course Run not found' });
            }
            dbCourseRunId = runRes.rows[0].id;
        }

        // Only staff or an assigned trainer of this class may post to it.
        if (!(await requireCourseRunTrainer((req as AuthedApiRequest).authUser!, res, dbCourseRunId))) return;

        let fileName: string | null = null;
        let fileUrl: string | null = null;
        let driveFileId: string | null = null;

        if (hasFile && file && (await getDocumentStorageProvider()) === 'onedrive') {
            try { fs.unlinkSync(file.filepath); } catch {}
            return res.status(501).json({
                success: false,
                error: 'Your company stores documents on Microsoft OneDrive, which is not connected to the LMS yet. Please upload the document to OneDrive and paste its share link in the web link box instead.',
            });
        }

        if (hasFile && file) {
            const driveFile = await uploadToClassDriveFolder(
                dbCourseRunId,
                file.filepath,
                file.originalFilename || 'attachment',
                file.mimetype || '',
            );
            if (driveFile) {
                fileName = file.originalFilename || 'attachment';
                fileUrl = driveFile.webViewLink;
                driveFileId = driveFile.fileId;
                try { fs.unlinkSync(file.filepath); } catch {}
            }
        }

        if (hasFile && file && !driveFileId) {
            // Documents live on Google Drive only, never on the app server's disk.
            try { fs.unlinkSync(file.filepath); } catch {}
            return res.status(502).json({
                success: false,
                error: 'The document could not be saved to Google Drive, so it was not posted. Please try again, or share it as a web link. If this keeps happening, ask an admin to check the Google integration in Company Setting.',
            });
        }

        const result = await pool.query(
            `INSERT INTO course_announcement (course_run_id, title, message, link_url, file_name, file_url, posted_by, drive_file_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, course_run_id AS "courseRunId", title, message, link_url AS "linkUrl",
                       file_name AS "fileName", file_url AS "fileUrl", posted_by AS "postedBy", created_at AS "createdAt"`,
            [dbCourseRunId, title, message, linkUrl, fileName, fileUrl, postedBy, driveFileId]
        );

        return res.status(200).json({
            success: true,
            announcement: result.rows[0],
        });
    } catch (error: any) {
        console.error('Error creating announcement:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
