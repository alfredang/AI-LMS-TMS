import { processDirectApplication } from '../lib/autoEnrolDirectApplications';
import pool from '../lib/db';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function test() {
  const traineeName = 'YOON BOON HONG';
  const res = await pool.query("SELECT id FROM da_application WHERE trainee_name ILIKE $1", [`%${traineeName}%`]);
  
  if (res.rows.length === 0) {
    console.log(`No record found for ${traineeName}`);
    return;
  }
  
  const id = res.rows[0].id;
  console.log(`Testing auto-enrol for ${traineeName} (ID: ${id})...`);
  
  // Reset status to allow re-run
  await pool.query("UPDATE da_application SET auto_enrol_status = NULL, auto_enrol_error = NULL WHERE id = $1", [id]);
  
  try {
    const result = await processDirectApplication(id);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Test failed with error:', err);
  } finally {
    await pool.end();
  }
}

test();
