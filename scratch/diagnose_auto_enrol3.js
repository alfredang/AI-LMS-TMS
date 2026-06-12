/**
 * Final diagnostic: understand the upload pattern.
 * Key finding: records created Apr 22 at 09:51, then updated at 11:04.
 * This suggests TWO uploads happened: first creating records, then updating status.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  // Check what the Apr 21 records looked like initially
  // The Apr 21 records were created at 10:01 and updated later.
  // The auto_enrol_status = 'enroled' means they were auto-enrolled LATER.
  // The question is: when were they enrolled? Was it at creation or after update?

  // Check the Apr 21 records more carefully - when did auto_enrol happen?
  const res = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           enrolment_id, auto_enrol_status, auto_enrol_error, 
           created_at, updated_at
    FROM da_application
    WHERE created_at::date = '2026-04-21'
    ORDER BY created_at ASC
  `);
  console.log('=== Apr 21 records (auto_enrol worked) ===');
  res.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | created: ${r.created_at.toISOString()} | updated: ${r.updated_at.toISOString()} | auto_enrol: ${r.auto_enrol_status} | enrol_id: ${r.enrolment_id}`);
  });

  // Now check: how many total records have auto_enrol_status = 'enroled' or 'invoiced'?
  // And what's the typical gap between created_at and updated_at for those?
  const enrolledRes = await pool.query(`
    SELECT trainee_name, application_id, auto_enrol_status, 
           created_at, updated_at,
           EXTRACT(EPOCH FROM (updated_at - created_at)) as seconds_gap
    FROM da_application
    WHERE auto_enrol_status IN ('enroled', 'invoiced', 'grant_found')
    ORDER BY created_at DESC
    LIMIT 30
  `);
  console.log('\n=== Records that WERE auto-enrolled (timing analysis) ===');
  enrolledRes.rows.forEach(r => {
    const gap = Math.round(r.seconds_gap);
    console.log(`  ${r.trainee_name} | auto_enrol: ${r.auto_enrol_status} | gap: ${gap}s | created: ${r.created_at.toISOString().slice(0,19)} | updated: ${r.updated_at.toISOString().slice(0,19)}`);
  });

  // Now the key question: What application_status do records have when FIRST uploaded?
  // Check if there are any records with "Confirm Application" status
  const confirmAppRes = await pool.query(`
    SELECT COUNT(*) as cnt FROM da_application
    WHERE LOWER(application_status) = 'confirm application'
  `);
  console.log(`\n=== Records with "Confirm Application" status: ${confirmAppRes.rows[0].cnt} ===`);

  // Check if ALL records come in as "Confirmed" (not "Confirm Application")
  // This would mean the SSG Excel only has "Confirmed" status
  const allStatuses = await pool.query(`
    SELECT DISTINCT application_status FROM da_application ORDER BY application_status
  `);
  console.log('\n=== All distinct application_status values ===');
  allStatuses.rows.forEach(r => console.log(`  "${r.application_status}"`));

  // THE KEY: Check what happens with the upload flow.
  // Records created at 09:51 with auto_enrol NULL = the auto trigger didn't fire.
  // But Apr 21 records created at 10:01 DO have auto_enrol = 'enroled'.
  // 
  // Possible explanation: The Apr 21 records were auto-enrolled via the MANUAL 
  // "Auto-Enrol" button click (not the automatic trigger).
  // Let's verify by checking the timing more carefully.

  const apr21Detail = await pool.query(`
    SELECT trainee_name, application_id, auto_enrol_status, 
           created_at, updated_at
    FROM da_application
    WHERE created_at::date = '2026-04-21'
      AND auto_enrol_status = 'enroled'
    ORDER BY updated_at ASC
  `);
  console.log('\n=== Apr 21 enrolled records (sorted by updated_at) ===');
  apr21Detail.rows.forEach(r => {
    console.log(`  ${r.trainee_name} | updated: ${r.updated_at.toISOString()} | created: ${r.created_at.toISOString()}`);
  });

  await pool.end();
}

check().catch(err => { console.error('Error:', err); process.exit(1); });
