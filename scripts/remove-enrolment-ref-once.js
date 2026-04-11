/**
 * One-off: remove local enrollment + staging by SSG enrolment reference (e.g. ENR-2604-045649).
 * Usage: node scripts/remove-enrolment-ref-once.js ENR-2604-045649
 */
require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node scripts/remove-enrolment-ref-once.js ENR-xxxx-xxxxx');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const ssl = process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });

(async () => {
  const client = await pool.connect();
  try {
    const peek = await client.query(
      `SELECT id, user_id, course_run_id, enrolment_id, enrolment_status FROM enrollment WHERE enrolment_id = $1`,
      [ref]
    );
    console.log('enrollment rows:', JSON.stringify(peek.rows, null, 2));

    await client.query('BEGIN');

    const ij = await client.query(`DELETE FROM invoice_jobs WHERE enrolment_id = $1 RETURNING id`, [ref]);
    console.log('deleted invoice_jobs:', ij.rowCount);

    const se = await client.query(`DELETE FROM ssg_enrolments WHERE enrolment_id = $1 RETURNING id`, [ref]);
    console.log('deleted ssg_enrolments:', se.rowCount);

    const sg = await client.query(`DELETE FROM ssg_grants WHERE enrollment_id = $1 RETURNING id`, [ref]);
    console.log('deleted ssg_grants:', sg.rowCount);

    const en = await client.query(
      `DELETE FROM enrollment WHERE enrolment_id = $1 RETURNING id, user_id, course_run_id`,
      [ref]
    );
    console.log('deleted enrollment:', en.rowCount, en.rows);

    await client.query('COMMIT');

    if (en.rows[0]?.user_id) {
      await pool.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`, [en.rows[0].user_id]);
      console.log('bumped courses_updated_at for user');
    }
    console.log('Done.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
