const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const res = await pool.query(`
    SELECT data_type 
    FROM information_schema.columns 
    WHERE table_name = 'course_run' AND column_name = 'start_date';
  `);
  console.log(res.rows[0]);
  process.exit(0);
}
run();
