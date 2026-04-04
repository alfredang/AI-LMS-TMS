const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    await pool.query('ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS nric text');
    await pool.query('ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS nationality text');
    await pool.query('ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS ethnicity text');
    await pool.query('ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS dob date');
    await pool.query('ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS secondary_email text');
    
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'developer_profile' ORDER BY ordinal_position"
    );
    console.log('developer_profile columns:', res.rows.map(r => r.column_name));
    
    await pool.end();
    console.log('Done!');
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

main();
