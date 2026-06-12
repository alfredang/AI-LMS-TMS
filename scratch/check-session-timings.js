const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false } : false,
});

async function run() {
  try {
    const ids = ['1131713', '1077505', '1131877'];
    const res = await pool.query(`
      SELECT cr.course_run_id, c.title, cs.start_date, cs.start_time, cs.end_time 
      FROM course_run cr 
      JOIN course c ON c.id = cr.course_id 
      JOIN course_session cs ON cs.course_run_id = cr.id 
      WHERE cr.course_run_id = ANY($1) 
      ORDER BY cr.course_run_id, cs.start_date;
    `, [ids]);
    
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
