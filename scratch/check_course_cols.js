require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const res = await pool.query(`
    SELECT column_name
    FROM information_schema.columns 
    WHERE table_name = 'course';
  `);
  console.log(res.rows.map(r => r.column_name));
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
