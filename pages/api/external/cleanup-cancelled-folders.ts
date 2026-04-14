import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
    getDriveClient,
    findSubfolder,
    findSessionFolderByStartDate,
    findCourseFolderByTgsRef,
    buildStartDatePrefix,
} from '../../../lib/google-drive/drive-helpers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const result = await pool.query(`
            SELECT
                log.id AS log_id,
                log.course_run_id,
                log.course_title,
                log.course_code,
                log.start_date,
                log.trainer_name,
                log.folder_name,
                cr.class_status
            FROM auto_create_trainer_folder_log log
            JOIN course_run cr ON log.course_run_id = cr.course_run_id
            WHERE cr.class_status = 'Cancelled'
              AND log.status IN ('created', 'existing')
        `);

        const logs = result.rows;
        if (logs.length === 0) {
            return res.status(200).json({ success: true, message: 'No cancelled classes with generated folders found.' });
        }

        const drive = await getDriveClient();
        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');

        let deletedCount = 0;
        let notEmptyCount = 0;
        let notFoundCount = 0;
        const details = [];

        for (const log of logs) {
            try {
                // Find course folder
                const tgsRef = log.course_code || null;
                const courseFolderId = await findCourseFolderByTgsRef(
                    drive, rootFolderId, tgsRef, log.course_code, log.course_title
                );

                if (!courseFolderId) {
                    details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'course_folder_not_found' });
                    notFoundCount++;
                    continue;
                }

                // Find 'Assessment Records' folder
                const assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
                if (!assessmentRecordsId) {
                    details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'assessment_records_not_found' });
                    notFoundCount++;
                    continue;
                }

                // Find the session folder
                const startDatePrefix = buildStartDatePrefix(new Date(log.start_date));
                const sessionFolderId = await findSessionFolderByStartDate(
                    drive, assessmentRecordsId, startDatePrefix, log.trainer_name
                );

                if (!sessionFolderId) {
                    details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'session_folder_not_found' });
                    notFoundCount++;
                    continue;
                }

                // Check if folder is empty
                const filesResponse = await drive.files.list({
                    q: `'${sessionFolderId}' in parents and trashed = false`,
                    fields: 'files(id, name)',
                    spaces: 'drive',
                });

                if (filesResponse.data.files && filesResponse.data.files.length > 0) {
                    details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'not_empty', files: filesResponse.data.files.length });
                    notEmptyCount++;
                } else {
                    // Empty, delete it
                    await drive.files.delete({ fileId: sessionFolderId });
                    
                    // Update log explicitly (or delete log row)
                    await pool.query('UPDATE auto_create_trainer_folder_log SET status = $1 WHERE id = $2', ['deleted', log.log_id]);
                    
                    details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'deleted' });
                    deletedCount++;
                }
            } catch (err: any) {
                console.error('Error processing log', log.log_id, err);
                details.push({ log_id: log.log_id, folder_name: log.folder_name, result: 'error', error: err.message });
            }
        }

        return res.status(200).json({
            success: true,
            summary: {
                total_processed: logs.length,
                deleted: deletedCount,
                not_empty_skipped: notEmptyCount,
                not_found: notFoundCount
            },
            details
        });
    } catch (err: any) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
    }
}
