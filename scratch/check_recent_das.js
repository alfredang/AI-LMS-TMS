require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const daRes = await pool.query(`
    SELECT trainee_email, course_title, course_run_id, course_reference_number
    FROM da_application 
    WHERE calendar_added = true 
    ORDER BY updated_at DESC 
    LIMIT 9
  `);
  console.log(daRes.rows);
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
