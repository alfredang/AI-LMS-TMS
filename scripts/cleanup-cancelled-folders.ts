import pool from '../lib/db';
import {
    getDriveClient,
    findSubfolder,
    findSessionFolderByStartDate,
    findCourseFolderByTgsRef,
    buildStartDatePrefix,
} from '../lib/google-drive/drive-helpers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    try {
        console.log('Starting cleanup...');
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
            console.log('No cancelled classes with generated folders found.');
            return;
        }

        const drive = await getDriveClient();
        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');

        let deletedCount = 0;
        let notEmptyCount = 0;
        let notFoundCount = 0;

        for (const log of logs) {
            try {
                // Find course folder
                const tgsRef = log.course_code || null;
                const courseFolderId = await findCourseFolderByTgsRef(
                    drive, rootFolderId, tgsRef, log.course_code, log.course_title
                );

                if (!courseFolderId) {
                    console.log(`[${log.folder_name}] Course folder not found.`);
                    notFoundCount++;
                    continue;
                }

                // Find 'Assessment Records' folder
                const assessmentRecordsId = await findSubfolder(drive, courseFolderId, 'Assessment Records');
                if (!assessmentRecordsId) {
                    console.log(`[${log.folder_name}] Assessment Records folder not found.`);
                    notFoundCount++;
                    continue;
                }

                // Find the session folder
                const startDatePrefix = buildStartDatePrefix(new Date(log.start_date));
                const sessionFolderId = await findSessionFolderByStartDate(
                    drive, assessmentRecordsId, startDatePrefix, log.trainer_name
                );

                if (!sessionFolderId) {
                    console.log(`[${log.folder_name}] Session folder not found.`);
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
                    console.log(`[${log.folder_name}] Not empty, skipping (${filesResponse.data.files.length} files).`);
                    notEmptyCount++;
                } else {
                    // Empty, delete it
                    await drive.files.delete({ fileId: sessionFolderId });
                    
                    // Update log explicitly (or delete log row)
                    await pool.query('UPDATE auto_create_trainer_folder_log SET status = $1 WHERE id = $2', ['deleted', log.log_id]);
                    
                    console.log(`[${log.folder_name}] DELETED (Empty folder).`);
                    deletedCount++;
                }
            } catch (err: any) {
                console.error(`[${log.folder_name}] Error processing log:`, err.message);
            }
        }

        console.log(`\nCleanup Complete!`);
        console.log(`Total processed: ${logs.length}`);
        console.log(`Deleted: ${deletedCount}`);
        console.log(`Not empty (skipped): ${notEmptyCount}`);
        console.log(`Not found: ${notFoundCount}`);

    } catch (err: any) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

run();
