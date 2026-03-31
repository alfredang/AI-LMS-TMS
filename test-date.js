const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const res = await pool.query(`SELECT COUNT(*) FROM course_run WHERE start_date >= $1`, ['2026/03/24']);
    console.log("SUCCESS:", res.rows[0].count);
  } catch (err) {
    console.log("ERROR:", err.message);
  }
  process.exit(0);
}
run();
