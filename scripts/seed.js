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

async function seedDatabase() {
  const client = await pool.connect()
  
  try {
    console.log('🌱 Seeding database with initial data...')
    
    // Read and execute initial_data.sql
    const seedPath = path.join(__dirname, '../../database/seeds/initial_data.sql')
    const seedSql = fs.readFileSync(seedPath, 'utf8')
    
    // Split by semicolon and execute each statement
    const statements = seedSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0)
    
    for (const statement of statements) {
      try {
        await client.query(statement)
        console.log('✅ Inserted data successfully')
      } catch (error) {
        if (error.message.includes('duplicate key')) {
          console.log('⚠️ Data already exists, skipping...')
        } else {
          console.error('❌ Error inserting data:', error.message)
          throw error
        }
      }
    }
    
    console.log('✅ Database seeding completed successfully!')
    
    // Display some stats
    const userCount = await client.query('SELECT COUNT(*) FROM app_user')
    const learnerCount = await client.query('SELECT COUNT(*) FROM learner_profile')
    
    console.log(`📊 Database stats:`)
    console.log(`   Users: ${userCount.rows[0].count}`)
    console.log(`   Learner profiles: ${learnerCount.rows[0].count}`)
    
  } catch (error) {
    console.error('❌ Seeding failed:', error.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

// Run seeding if called directly
if (require.main === module) {
  seedDatabase()
}

module.exports = { seedDatabase }
