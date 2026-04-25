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
    WHERE table_name = 'da_application';
  `);
  console.log('Columns in da_application:', res.rows.map(r => r.column_name).join(', '));
  
  const daRes = await pool.query(`SELECT id, trainee_name, course_title, course_run_id, trainee_email FROM da_application ORDER BY created_at DESC LIMIT 15`);
  console.log('Recent DAs:', daRes.rows);
  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
