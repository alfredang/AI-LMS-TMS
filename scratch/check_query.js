require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  try {
    const res = await pool.query(
      `SELECT id FROM course_run WHERE id = $1`,
      ['TGS-2023018861']
    );
    console.log('Success:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  }
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
