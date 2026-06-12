require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'course_session';
  `);
  console.log(res.rows);

  const res2 = await pool.query(`
    SELECT * FROM course_session LIMIT 1;
  `);
  console.log(res2.rows);

  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
