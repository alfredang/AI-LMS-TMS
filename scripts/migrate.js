require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiary_db',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
})

async function runMigration() {
  const client = await pool.connect()
  
  try {
    console.log('🗄️ Running database migration...')
    
    // Read and execute schema.sql
    const schemaPath = path.join(__dirname, '../../database/db_schema.sql')
    const schemaSql = fs.readFileSync(schemaPath, 'utf8')
    
    // Split by semicolon and execute each statement
    const statements = schemaSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0)
    
    for (const statement of statements) {
      try {
        await client.query(statement)
        console.log('✅ Executed statement successfully')
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️ Table/function already exists, skipping...')
        } else {
          console.error('❌ Error executing statement:', error.message)
          throw error
        }
      }
    }
    
    console.log('✅ Database migration completed successfully!')
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
}

module.exports = { runMigration }
