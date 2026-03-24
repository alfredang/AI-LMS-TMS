const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const res = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name ILIKE '%enrol%'
  `);
  console.log('Tables matching %enrol%:');
  res.rows.forEach(r => console.log(r.table_name));

  for (const row of res.rows) {
      const colRes = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [row.table_name]);
      console.log(`\n=== ${row.table_name} ===`);
      colRes.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type}`));
  }

  process.exit(0);
}
main().catch(console.error);
