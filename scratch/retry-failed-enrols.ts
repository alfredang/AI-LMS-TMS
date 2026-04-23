import { processDirectApplication } from '../lib/autoEnrolDirectApplications';
import pool from '../lib/db';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function retryFailed() {
  console.log('Searching for failed auto-enrolments with decryption errors...');
  
  const res = await pool.query(`
    SELECT id, trainee_name FROM da_application 
    WHERE auto_enrol_status = 'failed' 
    AND auto_enrol_error LIKE '%wrong final block length%'
  `);
  
  console.log(`Found ${res.rows.length} records to retry.`);
  
  for (const row of res.rows) {
    console.log(`Retrying for ${row.trainee_name} (${row.id})...`);
    try {
      const result = await processDirectApplication(row.id);
      if (result.success) {
        console.log(`✅ Success for ${row.trainee_name}`);
      } else {
        console.log(`❌ Failed for ${row.trainee_name}: ${result.error}`);
      }
    } catch (err) {
      console.error(`❌ Unexpected error for ${row.trainee_name}:`, err);
    }
  }
  
  await pool.end();
}

retryFailed();
