const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const res = await pool.query(`
    SELECT application_id, trainee_name, application_status, auto_enrol_status, enrolment_status, enrolment_id, created_at, updated_at, auto_enrol_error 
    FROM da_application 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  console.table(res.rows);
  pool.end();
}
run();
