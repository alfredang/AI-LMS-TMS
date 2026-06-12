
require('dotenv').config({ path: '.env.local' });
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'trainer_invitation'
    `);
    console.log('Schema for trainer_invitation:');
    console.table(res.rows);

    const samples = await pool.query(`
      SELECT id, trainer_name, start_date, status, responded_at 
      FROM trainer_invitation 
      WHERE status = 'accepted' 
      LIMIT 5
    `);
    console.log('\nSample accepted invitations:');
    for (const row of samples.rows) {
        console.log(`ID: ${row.id}, StartDate type: ${typeof row.start_date}, Value: ${row.start_date}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
