require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const res = await pool.query(`SELECT id, title, course_link, courseware_link FROM course WHERE title LIKE '%3D Modelling%' LIMIT 5`);
  console.log(JSON.stringify(res.rows, null, 2));
  
  process.exit(0);
}
main().catch(console.error);
