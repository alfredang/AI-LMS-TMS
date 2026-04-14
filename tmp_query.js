// Quick script to find Alston's upcoming enrollments
const pool = require('./lib/db').default;

async function main() {
  try {
    const result = await pool.query(`
      SELECT e.id, e.course_run_id, cr.course_run_id as ssg_run_id, c.title, 
             e.enrolment_status, cr.start_date::text
      FROM enrollment e
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = cr.course_id
      WHERE e.user_id = 'f0fc23ba-3bf8-4f69-803b-f86772bc209b'
        AND cr.start_date > CURRENT_DATE
      ORDER BY cr.start_date;
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
main();
