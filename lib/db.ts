import { Pool } from 'pg';

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL is not set. Database connections will fail.');
}

// Create connection pool with support for both local and Supabase (cloud) databases
const pool = new Pool({
  // Option 1: Use DATABASE_URL (recommended for Supabase)
  connectionString: process.env.DATABASE_URL,

  // SSL configuration - only enable for production or when URL contains 'supabase'
  ssl: process.env.DATABASE_URL && (process.env.NODE_ENV === 'production')
    ? { rejectUnauthorized: false }
    : false,

  // Connection pool settings optimized for serverless (Vercel)
  // Keep these low for serverless environments
  max: 5, // Reduced for serverless - each function instance has its own pool
  idleTimeoutMillis: 10000, // Close idle clients after 10 seconds
  connectionTimeoutMillis: 10000, // Return an error if connection takes longer than 10 seconds
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
});

export default pool;
