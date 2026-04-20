import { Pool } from 'pg';

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL is not set. Database connections will fail.');
}

// Create connection pool with support for both local and Supabase (cloud) databases
const pool = new Pool({
  // Option 1: Use DATABASE_URL (recommended for Supabase)
  connectionString: process.env.DATABASE_URL,

  // SSL configuration - enable for Supabase (cloud) or production
  ssl: process.env.DATABASE_URL && (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('supabase'))
    ? { rejectUnauthorized: false }
    : false,

  // Connection pool settings
  max: 10, // Allow more concurrent connections
  idleTimeoutMillis: 10000, // Close idle clients after 10 seconds
  connectionTimeoutMillis: 15000, // Return an error if connection takes longer than 15 seconds
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
});

// Auto-migrations: safe to run on every startup (all use IF NOT EXISTS)
pool.query(`
  ALTER TABLE da_application ADD COLUMN IF NOT EXISTS invoice_drive_file_id text;
`).catch((err) => {
  console.warn('⚠️ Auto-migration warning:', err.message);
});

export default pool;
