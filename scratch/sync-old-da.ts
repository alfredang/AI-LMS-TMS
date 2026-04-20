import * as dotenv from 'dotenv';
import pool from '../lib/db';
import { createNativeEnrolmentFromDA } from '../lib/autoEnrolDirectApplications';

dotenv.config({ path: '.env.local' });

async function run() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM da_application 
       WHERE enrolment_status = 'Confirmed' 
         AND enrolment_id IS NULL 
         AND trainee_email IS NOT NULL`
    );

    console.log(`Found ${rows.length} unenrolled Confirmed DA applications.`);

    let count = 0;
    for (const record of rows) {
      console.log(`Processing DA: ${record.application_id} (${record.trainee_email})`);
      const success = await createNativeEnrolmentFromDA(record, pool);
      if (success) {
        count++;
        console.log(`✅ Success for ${record.application_id}`);
      } else {
        console.log(`❌ Failed for ${record.application_id}`);
      }
    }

    console.log(`\nCompleted processing. Successfully enrolled ${count}/${rows.length} applications.`);

  } catch (err) {
    console.error('Fatal Error:', err);
  } finally {
    pool.end();
  }
}

run();
