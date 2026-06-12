/**
 * Check the Apr 21 records that were not auto-enrolled.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  // All Apr 21 records
  const res = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           enrolment_id, auto_enrol_status, auto_enrol_error, created_at
    FROM da_application
    WHERE created_at::date = '2026-04-21'
    ORDER BY created_at ASC
  `);
  console.log(`=== Apr 21 records (${res.rows.length}) ===`);
  res.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | app_status: "${r.application_status}" | enrol_status: ${r.enrolment_status || 'NULL'} | auto_enrol: ${r.auto_enrol_status || 'NULL'} | error: ${r.auto_enrol_error || 'none'}`);
  });

  // Apr 22 records (today)
  const res2 = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           enrolment_id, auto_enrol_status, auto_enrol_error, created_at
    FROM da_application
    WHERE created_at::date = '2026-04-22'
    ORDER BY created_at ASC
  `);
  console.log(`\n=== Apr 22 records (${res2.rows.length}) ===`);
  res2.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | app_status: "${r.application_status}" | enrol_status: ${r.enrolment_status || 'NULL'} | auto_enrol: ${r.auto_enrol_status || 'NULL'} | error: ${r.auto_enrol_error || 'none'}`);
  });

  // Check Apr 20 records (which DID get enrolled) for comparison
  const res3 = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           enrolment_id, auto_enrol_status, auto_enrol_error, created_at
    FROM da_application
    WHERE created_at::date = '2026-04-20'
    ORDER BY created_at ASC
    LIMIT 10
  `);
  console.log(`\n=== Apr 20 records (comparison - these worked) ===`);
  res3.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | app_status: "${r.application_status}" | enrol_status: ${r.enrolment_status || 'NULL'} | auto_enrol: ${r.auto_enrol_status || 'NULL'} | enrol_id: ${r.enrolment_id || 'NULL'}`);
  });

  // Check if Apr 21 records were uploaded as NEW (inserted) or updated
  // If they were UPDATED (status change), the auto-enrol wouldn't fire
  const res4 = await pool.query(`
    SELECT trainee_name, application_id, created_at, updated_at,
           CASE WHEN updated_at > created_at + interval '1 second' THEN 'UPDATED' ELSE 'INSERTED' END as likely_action
    FROM da_application
    WHERE created_at::date >= '2026-04-20'
    ORDER BY created_at ASC
  `);
  console.log(`\n=== Insert vs Update analysis (Apr 20+) ===`);
  res4.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | ${r.likely_action} | created: ${r.created_at} | updated: ${r.updated_at}`);
  });

  await pool.end();
}

check().catch(err => { console.error('Error:', err); process.exit(1); });
