const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    // 1. Check distribution of auto_enrol_status for confirmed rows
    const statusDist = await pool.query(`
      SELECT 
        application_status,
        auto_enrol_status,
        COUNT(*) as count
      FROM da_application
      WHERE LOWER(application_status) IN ('confirmed', 'confirm application')
      GROUP BY application_status, auto_enrol_status
      ORDER BY application_status, auto_enrol_status
    `);
    console.log('\n=== auto_enrol_status distribution for confirmed rows ===');
    console.table(statusDist.rows);

    // 2. Find confirmed rows that DON'T have a real ENR- enrolment_id
    const notEnrolled = await pool.query(`
      SELECT 
        id,
        application_id,
        trainee_name,
        application_status,
        auto_enrol_status,
        auto_enrol_error,
        enrolment_id,
        enrolment_status,
        trainee_id,
        created_at
      FROM da_application
      WHERE LOWER(application_status) IN ('confirmed', 'confirm application')
        AND (enrolment_id IS NULL OR enrolment_id !~ '^ENR-')
      ORDER BY created_at DESC
      LIMIT 30
    `);
    console.log('\n=== Confirmed rows WITHOUT real ENR- enrolment_id (most recent 30) ===');
    console.table(notEnrolled.rows);

    // 3. Check if there are rows with enrolment_id but auto_enrol_status is still null/pending
    const mismatch = await pool.query(`
      SELECT 
        auto_enrol_status,
        CASE 
          WHEN enrolment_id IS NULL THEN 'NULL'
          WHEN enrolment_id ~ '^ENR-' THEN 'ENR-xxx'
          ELSE enrolment_id
        END as enrolment_id_type,
        COUNT(*) as count
      FROM da_application
      WHERE LOWER(application_status) IN ('confirmed', 'confirm application')
      GROUP BY auto_enrol_status, 
        CASE 
          WHEN enrolment_id IS NULL THEN 'NULL'
          WHEN enrolment_id ~ '^ENR-' THEN 'ENR-xxx'
          ELSE enrolment_id
        END
      ORDER BY auto_enrol_status, enrolment_id_type
    `);
    console.log('\n=== auto_enrol_status vs enrolment_id cross-tab ===');
    console.table(mismatch.rows);

    // 4. Show the most recently created rows to see what new ones look like
    const recent = await pool.query(`
      SELECT 
        id,
        application_id,
        trainee_name,
        application_status,
        auto_enrol_status,
        enrolment_id,
        enrolment_status,
        trainee_id,
        created_at,
        updated_at
      FROM da_application
      ORDER BY created_at DESC
      LIMIT 15
    `);
    console.log('\n=== 15 most recently created DA rows ===');
    console.table(recent.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
