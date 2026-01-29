
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Create connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function debugUser() {
    try {
        console.log('🔍 Connecting to database...');
        const client = await pool.connect();

        // 1. List all users with their roles (guessed from schema likely)
        // Or just look at app_user first
        console.log('\n-------- 5 Most Recent Users --------');
        const users = await client.query('SELECT id, email, full_name, created_at FROM app_user ORDER BY created_at DESC LIMIT 5');
        users.rows.forEach(u => console.log(`ID: ${u.id} | Email: ${u.email} | Name: ${u.full_name}`));

        if (users.rows.length > 0) {
            const userId = users.rows[0].id;
            console.log(`\n-------- Checking Profile for User ID: ${userId} --------`);

            // Check training_provider table
            const tp = await client.query('SELECT * FROM training_provider WHERE id = $1', [userId]);
            console.log(`Training Provider Entry (Direct ID match): ${tp.rows.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
            if (tp.rows.length > 0) console.log(tp.rows[0]);

            // Check provider_admin_user table
            const pau = await client.query('SELECT * FROM provider_admin_user WHERE user_id = $1', [userId]);
            console.log(`Provider Admin Entry (user_id match): ${pau.rows.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
            if (pau.rows.length > 0) {
                console.log(pau.rows[0]);
                const tp2 = await client.query('SELECT * FROM training_provider WHERE id = $1', [pau.rows[0].provider_id]);
                console.log(`Linked Provider: ${tp2.rows.length > 0 ? tp2.rows[0].company_name : 'NOT FOUND'}`);
            }
        }

        client.release();
    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

debugUser();
