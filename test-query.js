const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    const res = await pool.query("SELECT * FROM course_run WHERE course_run_id = '1322374'");
    console.log('Course Run:', res.rows[0]);
    if (!res.rows[0]) return;
    
    const db_uuid = res.rows[0].id;
    
    const enrolRes = await pool.query("SELECT * FROM enrollment WHERE course_run_id = $1", [db_uuid]);
    console.log('\nEnrollments:', enrolRes.rows.map(r => ({id: r.id, status: r.enrolment_status, cert: r.certificate})));
    
    const sessionsRes = await pool.query("SELECT * FROM course_session WHERE course_run_id = $1 AND deleted = false", [db_uuid]);
    console.log('\nSessions:', sessionsRes.rows.length);
    
    const attendanceRes = await pool.query(`
        SELECT e.nric, COUNT(DISTINCT ca.session_id) as attended
        FROM enrollment e
        LEFT JOIN course_attendance ca ON ca.user_id = e.user_id
        WHERE e.course_run_id = $1
        GROUP BY e.nric
    `, [db_uuid]);
    console.log('\nAttendance count:', attendanceRes.rows);
    
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
