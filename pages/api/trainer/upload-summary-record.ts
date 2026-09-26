import { withAuth, type AuthedApiRequest } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { getGoogleDriveFolderId } from '../../../lib/googleDriveFolder';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { ensureLearnerAssessmentFolder } from '../../../lib/google-drive/assessmentRecordFolder';

export const config = {
    api: {
        bodyParser: false,
    },
};

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
        const drive = await getDriveClient();
        const studentFolderId = await ensureLearnerAssessmentFolder(drive, parentFolderId, {
            courseCode: run.course_code,
            courseTitle: run.course_title,
            startDate: run.start_date,
            endDate: run.end_date,
            trainerName: run.trainer_common_name || run.assigned_trainer_name || 'Unknown Trainer',
            trainerCommonName: run.trainer_common_name,
        }, studentName);

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
