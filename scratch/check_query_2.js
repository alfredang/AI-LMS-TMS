require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  try {
    const res = await pool.query(
      `SELECT 
         cr.id as resolved_uuid,
         cr.course_run_id, 
         c.course_code,
         c.title as db_course_title
       FROM course_run cr
       LEFT JOIN course c ON c.id = cr.course_id
       WHERE (cr.id::text = $1 OR cr.course_run_id = $1)
       LIMIT 1`,
      ['1300354']
    );
    console.log('Success:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  }
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
