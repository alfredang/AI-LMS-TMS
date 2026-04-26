require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const daRes = await pool.query(`SELECT trainee_name, course_run_id, course_title, course_start_date FROM da_application WHERE trainee_name ILIKE '%KOK HONG BIN%'`);
  console.log('da_app:', daRes.rows);
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
