require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkKey() {
    try {
        await client.connect();
        console.log('Connected to DB');

        const res = await client.query(`
      SELECT key_name, key_value, created_at 
      FROM training_provider_api 
      WHERE key_name = 'gemini_api_key' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

        if (res.rows.length > 0) {
            console.log('Found key in DB:');
            console.log(JSON.stringify(res.rows[0], null, 2));
        } else {
            console.log('No gemini_api_key found in training_provider_api table.');
        }
    } catch (err) {
        console.error('Database error:', err);
    } finally {
        await client.end();
    }
}

checkKey();
