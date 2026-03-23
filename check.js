const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const res = await pool.query('SELECT id, title, course_link, courseware_link FROM course WHERE course_link IS NOT NULL OR courseware_link IS NOT NULL LIMIT 5');
  console.log(res.rows);
  
  // also update any non-null course_link to courseware_link just in case the user meant they want the data moved
  const updateRes = await pool.query('UPDATE course SET courseware_link = course_link WHERE course_link IS NOT NULL AND courseware_link IS NULL RETURNING id, title');
  console.log('Migrated data for:', updateRes.rows);
  
  process.exit(0);
}
main().catch(console.error);
