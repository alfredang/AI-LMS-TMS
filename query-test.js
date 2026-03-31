const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query() {
  const res = await pool.query(`
    SELECT cr.id, cr.course_run_id, cr.assigned_trainer_name,
      (SELECT STRING_AGG(trainer_name, ', ') FROM course_run_trainer WHERE course_run_id = cr.id) as aggregated
    FROM course_run cr
    WHERE cr.course_run_id = '1227873'
  `);
  console.log(res.rows);
  const crId = res.rows[0].id;
  
  const crt = await pool.query(`SELECT * FROM course_run_trainer WHERE course_run_id = $1`, [crId]);
  console.log("Junction Table rows:", crt.rows);
  process.exit(0);
}
query();
