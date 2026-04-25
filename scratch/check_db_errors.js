require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const res = await pool.query(`
    SELECT trainee_name, auto_enrol_status, auto_enrol_error, updated_at
    FROM da_application
    WHERE auto_enrol_status = 'failed' OR auto_enrol_status = 'pending'
    ORDER BY updated_at DESC
    LIMIT 20
  `);
  
  console.log('=== Pending or Failed auto-enrols ===');
  res.rows.forEach(r => {
    console.log(`${r.trainee_name} | Status: ${r.auto_enrol_status} | Error: ${r.auto_enrol_error}`);
  });

  await pool.end();
}

check().catch(err => { console.error('Error:', err); process.exit(1); });
