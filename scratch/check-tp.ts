import pool from '../lib/db';

async function run() {
  try {
    const { rows } = await pool.query(`SELECT google_client_id, google_client_secret, google_refresh_token FROM training_provider LIMIT 1`);
    console.log(JSON.stringify(rows[0], (key, value) => {
        if (key === 'google_client_secret' || key === 'google_refresh_token') {
            return value ? (value.substring(0, 5) + '...' + value.substring(value.length - 5)) : null;
        }
        return value;
    }, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
