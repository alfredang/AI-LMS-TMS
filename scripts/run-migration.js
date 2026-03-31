const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    console.log('🔄 Running database migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../../database/migrations/001_add_submission_file_url.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await pool.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    console.log('✅ Added file_url column to submission table');
    console.log('✅ Added unique constraint for enrollment_id and assessment_id');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  } finally {
    await pool.end();
  }
}

runMigration();
