const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({});
async function run() {
  try {
    const res = await pool.query("SELECT id, trainee_name, application_status, enrolment_status, created_at, updated_at, calendar_added FROM da_application WHERE trainee_name ILIKE '%TAN WEI CHENG THONEE%'");
    console.log(res.rows);
  } finally {
    await pool.end();
  }
}
run();
