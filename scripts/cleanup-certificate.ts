import pool from '../lib/db';
import { getDriveClient } from '../lib/google-drive/drive-helpers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    try {
        const fileId = '1J70BNzRy9MJWQhh5PggM6uC_wsOgi6Nt';
        
        console.log(`Deleting file from Google Drive: ${fileId}...`);
        try {
            const drive = await getDriveClient();
            await drive.files.delete({ fileId });
            console.log('Successfully deleted file from Google Drive.');
        } catch (driveErr: any) {
            console.error('Failed to delete file from Google Drive:', driveErr.message);
            if (driveErr.message.includes('File not found')) {
                console.log('File was already deleted from Drive.');
            }
        }

        console.log('Removing certificate link from enrollment database...');
        // Just in case it's there
        await pool.query(`
            UPDATE enrollment e
            SET certificate = NULL
            FROM course_run cr
            WHERE e.course_run_id = cr.id
              AND cr.course_run_id = '1078976'
              AND (e.nric ILIKE '%LEE SOOK CHING%' OR EXISTS (SELECT 1 FROM app_user au WHERE au.id = e.user_id AND au.full_name ILIKE '%LEE SOOK CHING%'))
        `);
        
        // Also log in auto_create_certificates_log
        await pool.query(`
            UPDATE auto_create_certificates_log
            SET status = 'deleted_manually'
            WHERE course_run_id = '1078976' AND learner_name ILIKE '%LEE SOOK CHING%'
        `);

        console.log('Cleanup Complete!');
    } catch (err: any) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

run();
