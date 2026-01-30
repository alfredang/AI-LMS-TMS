// Script to run OAuth migration
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('🔄 Running OAuth migration...');

        const migrationPath = path.join(__dirname, '../database/migrations/add_oauth_support.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        await pool.query(migrationSQL);

        console.log('✅ OAuth migration completed successfully!');

        // Verify the changes
        const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'app_user'
      AND column_name IN ('supabase_user_id', 'auth_provider', 'password', 'password_hash')
      ORDER BY column_name;
    `);

        console.log('\n📋 Updated app_user table columns:');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
