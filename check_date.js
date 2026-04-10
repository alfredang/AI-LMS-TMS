const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env.local') });

async function checkDateFormat() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const result = await pool.query('SELECT start_date FROM course_run LIMIT 1');
    const row = result.rows[0];
    console.log('Raw start_date from DB:', row.start_date);
    console.log('Type of start_date:', typeof row.start_date);
    if (row.start_date instanceof Date) {
      console.log('toISOString():', row.start_date.toISOString());
      console.log('toLocaleDateString():', row.start_date.toLocaleDateString());
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkDateFormat();
