import { removeDaLearnerFromCalendar } from '../lib/google-calendar/da-calendar-sync';
import pool from '../lib/db';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function runRemovalCleanup() {
  console.log('Running targeted removal for cancelled applications...');
  try {
    const cancelledRes = await pool.query(
      `SELECT id, trainee_email, course_title, course_run_id, course_start_date 
       FROM da_application 
       WHERE calendar_added IS TRUE
         AND trainee_email IS NOT NULL
         AND LOWER(application_status) IN ('cancelled', 'rejected', 'failed')`
    );

    if (cancelledRes.rows.length === 0) {
      console.log('No cancelled applications found that are still marked as on calendar.');
      return;
    }

    console.log(`🗑️ Found ${cancelledRes.rows.length} cancelled applications. Removing...`);
    for (const da of cancelledRes.rows) {
       console.log(`Processing removal for ${da.trainee_email} - ${da.course_title}`);
       const runRes = await pool.query(
         `SELECT id FROM course_run 
          WHERE (id::text = $1 OR course_run_id = $1) 
            AND is_deleted IS NOT TRUE LIMIT 1`,
         [da.course_run_id]
       );
       
       const courseRunUuid = runRes.rows[0]?.id || da.course_run_id;
       const removeRes = await removeDaLearnerFromCalendar(
         da.trainee_email,
         courseRunUuid,
         da.course_title || '',
         da.course_start_date
       );

       if (removeRes.removedFrom > 0 || removeRes.totalSessions > 0) {
          console.log(`✅ Removed ${da.trainee_email} from ${removeRes.removedFrom} events.`);
          await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = $1`, [da.id]);
       } else {
          console.log(`ℹ️ No events found to remove ${da.trainee_email} from (already removed or never existed). Unticking CAL.`);
          await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = $1`, [da.id]);
       }
    }
    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Cleanup failed:', err);
  } finally {
    await pool.end();
  }
}

runRemovalCleanup();
