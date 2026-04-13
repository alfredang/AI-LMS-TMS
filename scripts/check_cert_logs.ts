import pool from '../lib/db';
async function run() {
  const res = await pool.query(`SELECT status, certificate_url, error_message, created_at FROM auto_create_certificates_log WHERE course_run_id = '1078976' AND learner_name ILIKE '%LEE SOOK CHING%'`);
  console.log('Logs:', res.rows);
  process.exit();
}
run();
