/**
 * Diagnose why auto-enrol isn't working for newly uploaded DA records.
 * Checks: auto_enrol_status, application_status, and recent records.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function diagnose() {
  console.log('=== DA Auto-Enrol Diagnostic ===\n');

  // 1. Check training provider toggle
  const tpRes = await pool.query(`
    SELECT auto_enrol_direct_applications, auto_generate_qb_invoice, 
           auto_add_learner_to_calendar, sync_google_calendar
    FROM training_provider LIMIT 1
  `);
  console.log('1. Training Provider Settings:');
  console.log(JSON.stringify(tpRes.rows[0], null, 2));
  console.log();

  // 2. Check the specific learners mentioned by user
  const specificRes = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status, 
           enrolment_id, auto_enrol_status, auto_enrol_error, 
           created_at, updated_at
    FROM da_application
    WHERE trainee_name ILIKE '%NURUL AISHAH%' OR trainee_name ILIKE '%WONG ZHEN%' OR trainee_name ILIKE '%BENNETT%'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(`2. Specific Learners (${specificRes.rows.length} found):`);
  specificRes.rows.forEach(r => {
    console.log(`   ${r.trainee_name} | app_status: ${r.application_status} | enrol_status: ${r.enrolment_status || 'NULL'} | auto_enrol: ${r.auto_enrol_status || 'NULL'} | error: ${r.auto_enrol_error || 'none'} | created: ${r.created_at}`);
  });
  console.log();

  // 3. Check distribution of auto_enrol_status across ALL records
  const statusDist = await pool.query(`
    SELECT auto_enrol_status, COUNT(*) as cnt
    FROM da_application
    GROUP BY auto_enrol_status
    ORDER BY cnt DESC
  `);
  console.log('3. Auto-Enrol Status Distribution:');
  statusDist.rows.forEach(r => {
    console.log(`   ${r.auto_enrol_status || 'NULL'}: ${r.cnt}`);
  });
  console.log();

  // 4. Check distribution of application_status
  const appStatusDist = await pool.query(`
    SELECT application_status, COUNT(*) as cnt
    FROM da_application
    GROUP BY application_status
    ORDER BY cnt DESC
  `);
  console.log('4. Application Status Distribution:');
  appStatusDist.rows.forEach(r => {
    console.log(`   "${r.application_status}": ${r.cnt}`);
  });
  console.log();

  // 5. Check records created today (or recently) that have NULL auto_enrol_status
  const recentNull = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           auto_enrol_status, auto_enrol_error, created_at
    FROM da_application
    WHERE auto_enrol_status IS NULL
    ORDER BY created_at DESC
    LIMIT 30
  `);
  console.log(`5. Recent records with NULL auto_enrol_status (${recentNull.rows.length} shown):`);
  recentNull.rows.forEach(r => {
    console.log(`   ${r.trainee_name} | app_status: "${r.application_status}" | enrol_status: ${r.enrolment_status || 'NULL'} | created: ${r.created_at}`);
  });
  console.log();

  // 6. Check records with 'failed' auto_enrol_status and their errors
  const failedRes = await pool.query(`
    SELECT trainee_name, application_id, application_status, auto_enrol_status, auto_enrol_error, created_at
    FROM da_application
    WHERE auto_enrol_status = 'failed'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(`6. Failed auto-enrol records (${failedRes.rows.length} shown):`);
  failedRes.rows.forEach(r => {
    console.log(`   ${r.trainee_name} | app_status: "${r.application_status}" | error: ${r.auto_enrol_error} | created: ${r.created_at}`);
  });
  console.log();

  // 7. Check records created in the last 3 days
  const last3Days = await pool.query(`
    SELECT trainee_name, application_id, application_status, enrolment_status,
           enrolment_id, auto_enrol_status, auto_enrol_error,
           created_at::date as created_date
    FROM da_application
    WHERE created_at > NOW() - INTERVAL '3 days'
    ORDER BY created_at DESC
  `);
  console.log(`7. Records created in last 3 days (${last3Days.rows.length} total):`);
  const byDate = {};
  last3Days.rows.forEach(r => {
    const d = r.created_date?.toISOString?.()?.slice(0,10) || 'unknown';
    if (!byDate[d]) byDate[d] = { total: 0, null_enrol: 0, enrolled: 0, failed: 0 };
    byDate[d].total++;
    if (!r.auto_enrol_status) byDate[d].null_enrol++;
    else if (r.auto_enrol_status === 'failed') byDate[d].failed++;
    else byDate[d].enrolled++;
  });
  Object.entries(byDate).forEach(([date, stats]) => {
    console.log(`   ${date}: ${stats.total} total | ${stats.null_enrol} NULL | ${stats.enrolled} enrolled | ${stats.failed} failed`);
  });
  console.log();

  // 8. Show a few recent records with full detail
  console.log('8. Last 10 created records (full detail):');
  last3Days.rows.slice(0, 10).forEach(r => {
    console.log(`   ${r.trainee_name} | app_id: ${r.application_id} | app_status: "${r.application_status}" | enrol_status: ${r.enrolment_status || 'NULL'} | enrol_id: ${r.enrolment_id || 'NULL'} | auto_enrol: ${r.auto_enrol_status || 'NULL'} | error: ${r.auto_enrol_error || 'none'}`);
  });

  await pool.end();
}

diagnose().catch(err => { console.error('Error:', err); process.exit(1); });
