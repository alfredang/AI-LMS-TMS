const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable'
});

async function main() {
  const res = await pool.query(`SELECT id, title, course_link, courseware_link FROM course WHERE title LIKE '%3D Modelling%' LIMIT 5`);
  console.log(JSON.stringify(res.rows, null, 2));
  
  process.exit(0);
}
main().catch(console.error);
