import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config(); // Also try default .env
if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Database connections will fail.');
}

// Create connection pool with support for both local and Supabase (cloud) databases
const pool = new Pool({
  // Option 1: Use DATABASE_URL (recommended for Supabase)
  connectionString: process.env.DATABASE_URL,

  // SSL configuration - enable for Supabase (cloud) or production
  ssl:
    process.env.DATABASE_URL &&
    (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('supabase'))
      ? { rejectUnauthorized: false }
      : false,

  // Connection pool settings
  max: 30,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
});

// Auto-migrations: safe to run on every startup (all use IF NOT EXISTS)
pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS invoice_doc_number text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS invoice_drive_file_id text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS invoice_drive_web_view_link text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS grant_invoice_drive_file_id text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS grant_invoice_drive_web_view_link text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS sfc_invoice_drive_file_id text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS sfc_invoice_drive_web_view_link text;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS grant_invoice_id character varying(100);
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE da_application ADD COLUMN IF NOT EXISTS sfc_invoice_id character varying(100);
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS show_lesson_plan_learner_view boolean DEFAULT false NOT NULL;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

export default pool;
