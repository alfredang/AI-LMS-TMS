require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const VALID_API_KEY = 'AIzaSyBBUj0GgtcltKHSR9FpGjS2W04XInzXSWE'; // The known good key

async function seedKey() {
    try {
        await client.connect();
        console.log('Connected to DB');

        // 1. Find a training provider
        const tpRes = await client.query('SELECT id, company_name FROM training_provider LIMIT 1');
        if (tpRes.rows.length === 0) {
            console.error('❌ No Training Provider found in DB. Cannot insert API key.');
            return;
        }

        const providerId = tpRes.rows[0].id;
        console.log(`Found Training Provider: ${tpRes.rows[0].company_name} (${providerId})`);

        // 2. Check if key already exists
        const keyRes = await client.query(`
        SELECT id FROM training_provider_api 
        WHERE training_provider_id = $1 AND key_name = 'gemini_api_key'
    `, [providerId]);

        if (keyRes.rows.length > 0) {
            // Update existing
            console.log('Updating existing API Key...');
            await client.query(`
            UPDATE training_provider_api
            SET key_value = $1, selected_model = 'gemini-2.5-flash', updated_at = now()
            WHERE id = $2
        `, [VALID_API_KEY, keyRes.rows[0].id]);
        } else {
            // Insert new
            console.log('Inserting new API Key...');
            await client.query(`
            INSERT INTO training_provider_api (training_provider_id, key_name, key_value, selected_model)
            VALUES ($1, 'gemini_api_key', $2, 'gemini-2.5-flash')
        `, [providerId, VALID_API_KEY]);
        }

        console.log('✅ API apiKey successfully seeded into Database!');

    } catch (err) {
        console.error('Database error:', err);
    } finally {
        await client.end();
    }
}

seedKey();
