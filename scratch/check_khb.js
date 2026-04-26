require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const res = await pool.query(`SELECT * FROM course_run WHERE course_run_id = '1300354'`);
  console.log('course_run:', res.rows.length);
  const daRes = await pool.query(`SELECT trainee_name, course_run_id, course_title FROM da_application WHERE trainee_name ILIKE '%KOK HONG BIN%'`);
  console.log('da_app:', daRes.rows);
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
