require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
  const lockString = `cal-create-uuid-date`;
  const lockId = parseInt(crypto.createHash('sha256').update(lockString).digest('hex').slice(0, 15), 16);
  console.log('lockId:', lockId);
  try {
    await pool.query('SELECT pg_advisory_lock($1)', [lockId]);
    console.log('Lock acquired!');
    await pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
  } catch (err) {
    console.error('Lock error:', err.message);
  }

  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
