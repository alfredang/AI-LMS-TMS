import pool from './lib/db';
async function test() {
  const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'enrollment'");
  console.log(rows);
  process.exit();
}
test();
