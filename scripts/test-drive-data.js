const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  connectionString: 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable'
});

async function main() {
  const tpRes = await pool.query("SELECT * FROM trainer_profile LIMIT 1").catch(e => console.log(e.message));
  if (tpRes && tpRes.rows) console.log('trainer_profile cols:', Object.keys(tpRes.rows[0]));

  const urRes = await pool.query("SELECT * FROM user_role LIMIT 1").catch(e => console.log(e.message));
  if (urRes && urRes.rows) {
      console.log('user_role cols:', Object.keys(urRes.rows[0]));
      const urResAll = await pool.query("SELECT * FROM user_role LIMIT 5");
      console.log('user_role sample:', urResAll.rows);
  }

  process.exit(0);
}
main().catch(console.error);
