const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const result = await pool.query(`
    SELECT
        tc.constraint_name, 
        tc.constraint_type,
        kcu.column_name
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'admin_profile';
  `);
  console.table(result.rows);
  process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
