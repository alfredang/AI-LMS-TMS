import { NextApiRequest, NextApiResponse } from 'next';
import { google, drive_v3 } from 'googleapis';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { getGoogleDriveFolderId } from '../../../lib/googleDriveFolder';

export const config = {
    api: {
        bodyParser: true,
    },
};


async function findSubfolder(drive: drive_v3.Drive, parentFolderId: string, folderName: string): Promise<string | null> {
    const safeName = folderName.replace(/'/g, "\\'");
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

async function findSessionFolderByStartDate(
    drive: drive_v3.Drive,
    parentFolderId: string,
    startDatePrefix: string,
    trainerCommonName?: string
): Promise<string | null> {
    const response = await drive.files.list({
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
                return f.name.toLowerCase().includes(commonLower);
            });
            if (matched) return matched.id!;
        }
        // Fallback: match by start date prefix only
        const matched = files.find(f => f.name?.startsWith(startDatePrefix));
        if (matched) return matched.id!;
    }
    return null;
}

function buildStartDatePrefix(startDate: Date): string {
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const startDD = String(startDate.getDate()).padStart(2, '0');
    return `${yyyy}_${mm}_${startDD}`;
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: `Method ${req.method} not allowed. Use GET.` });
    }

    const { courseCode, courseName, studentName, courseRunId } = req.query as {
        courseCode: string;
        courseName: string;
        studentName: string;
        courseRunId: string;
    };

    if (!studentName || !courseRunId) {
        return res.status(400).json({ success: false, error: 'Missing studentName or courseRunId' });
    }

    const parentFolderId = await getGoogleDriveFolderId();
    if (!parentFolderId) {
        return res.status(500).json({ success: false, error: 'Google Drive Root Folder ID is not configured. Set it in Company Setting → Integration → Google.' });
    }

    try {
        const drive = await getDriveClient();

        // 1. Get Course Run Details
        const runDetails = await getCourseRunDetails(courseRunId);
        if (!runDetails) {
            return res.status(404).json({ success: false, exists: false, error: 'Course Run not found in DB' });
        }

        const effectiveCourseCode = courseCode || runDetails.course_code;
        const effectiveCourseName = courseName || runDetails.course_title;
        const startDatePrefix = buildStartDatePrefix(new Date(runDetails.start_date));

        // 2. Find Course Folder
        let courseFolderId = null;
        let tgsRef = effectiveCourseCode;
        if (!tgsRef) {
            const tgsMatch = effectiveCourseName.match(/(TGS-\\d+)/);
            if (tgsMatch) tgsRef = tgsMatch[1];
        }

        if (tgsRef) {
            const safeTgsRef = tgsRef.replace(/'/g, "\\'");
            const tgsResponse = await drive.files.list({
                q: `'${parentFolderId}' in parents and name contains '${safeTgsRef}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            if (tgsResponse.data.files && tgsResponse.data.files.length > 0) {
                courseFolderId = tgsResponse.data.files[0].id!;
            }
        } else {
            const expectedName = (`${effectiveCourseCode} ${effectiveCourseName}`).trim();
            courseFolderId = await findSubfolder(drive, parentFolderId, expectedName);
        }

        if (!courseFolderId) return res.status(200).json({ success: true, exists: false, count: 0, reason: 'Course root folder not found' });

        // 3. Find 'Assessment Records' Subfolder
        const assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
        if (!assessmentRecordsId) return res.status(200).json({ success: true, exists: false, count: 0, reason: 'Assessment Records folder not found' });

        // 4. Find Session Subfolder (match by start date + trainer common name)
        const trainerCommonName = runDetails.trainer_common_name || '';
        const sessionFolderId = await findSessionFolderByStartDate(drive, assessmentRecordsId, startDatePrefix, trainerCommonName);
        if (!sessionFolderId) return res.status(200).json({ success: true, exists: false, count: 0, reason: 'Session folder not found' });

        // 5. Find Learner Subfolder
        const studentFolderId = await findSubfolder(drive, sessionFolderId, studentName);
        if (!studentFolderId) return res.status(200).json({ success: true, exists: false, count: 0, reason: 'Learner folder not found' });

        // 6. Check files inside Learner Subfolder
        const filesResponse = await drive.files.list({
            q: `'${studentFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, createdTime)',
            spaces: 'drive',
        });

        const files = filesResponse.data.files || [];
        
        return res.status(200).json({
            success: true,
            exists: files.length > 0,
            count: files.length,
            files: files.map(f => ({ id: f.id, name: f.name, createdTime: f.createdTime }))
        });

    } catch (error: any) {
        console.error('Drive verification error:', error);
        return res.status(500).json({ success: false, error: 'Failed to verify with Google Drive', details: error.message });
    }
}
