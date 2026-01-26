import { Pool } from 'pg';

// Create connection pool with support for both local and Supabase (cloud) databases
const pool = new Pool({
  // Option 1: Use DATABASE_URL (recommended for Supabase)
  connectionString: process.env.DATABASE_URL,

  // Option 2: Use individual connection parameters (fallback for local development)
  // user: process.env.DB_USER || 'postgres',
  // host: process.env.DB_HOST || 'localhost',
  // database: process.env.DB_NAME || 'tertiarydb',
  // password: process.env.DB_PASSWORD || 'shuo1314520.',
  // port: parseInt(process.env.DB_PORT || '5432'),

  // SSL configuration for Supabase (required for cloud databases)
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,

  // Connection pool settings optimized for serverless (Vercel)
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
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
