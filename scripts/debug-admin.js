const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('--- app_user table (admin roles) ---');
  let users;
  try {
      users = await pool.query(`
        SELECT u.id, u.email, u.full_name, u.profile_picture_url 
        FROM app_user u
        JOIN user_roles r ON r.user_id = u.id
        WHERE r.role = 'admin'
        LIMIT 5;
      `);
      console.table(users.rows);
  } catch (e) {
      console.error(e);
  }

  console.log('--- admin_profile table ---');
  try {
      const admins = await pool.query(`
        SELECT * FROM admin_profile;
      `);
      console.table(admins.rows);
  } catch (e) {
      console.log('admin_profile does not exist or error:', e.message);
  }
  
  process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
