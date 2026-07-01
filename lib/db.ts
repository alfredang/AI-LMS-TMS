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

  // Connection pool settings.
  // Previously idleTimeoutMillis=10s with no keepAlive meant every ~30s poll / Coolify
  // health check opened a BRAND-NEW physical connection (the "Connected to PostgreSQL
  // database" log every 30s), and idle connections crossing the 6433→5432 Docker NAT
  // could be silently dropped ("connection terminated unexpectedly"). Keep connections
  // warm and alive so the app reuses them instead of re-handshaking through load windows
  // (e.g. the daily dump). idleTimeout↑ and keepAlive are paired on purpose: the longer
  // idle life is kept healthy by the keepalive probes (first probe after 10s), so idle
  // connections don't go stale across the NAT. (max and connectionTimeoutMillis left at
  // their prior values — this iteration isolates the churn fix.)
  max: 30,
  idleTimeoutMillis: 60_000,           // was 10_000 — reuse warm connections instead of tearing them down between polls
  connectionTimeoutMillis: 15_000,
  keepAlive: true,                     // NEW — TCP keepalive so the NAT doesn't silently drop idle connections
  keepAliveInitialDelayMillis: 10_000, // NEW — first keepalive probe after 10s idle (inside typical NAT timeouts)
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

pool
  .query(`
    ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS show_certificate_delivery boolean DEFAULT false NOT NULL;
    ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS certificate_delivery_label text DEFAULT 'TP Course Evaluation' NOT NULL;
    UPDATE training_provider
      SET show_certificate_delivery = true,
          certificate_delivery_label = 'Certificate of Achievement'
      WHERE uen = '201200696W'
        AND certificate_delivery_label IN ('TP Course Evaluation', 'Certificate Delivery');
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

pool
  .query(`
    ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS certificate_delivery_link text DEFAULT 'https://goo.gl/R2eumq' NOT NULL;
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

// Durable course_run -> Google Calendar event mapping (per session date).
// See database/migrations/create_course_run_calendar_event.sql.
pool
  .query(`
    CREATE TABLE IF NOT EXISTS course_run_calendar_event (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_run_id   uuid NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
      event_date      date NOT NULL,
      google_event_id text NOT NULL,
      base_event_id   text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (course_run_id, event_date)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crce_google_event_uniq ON course_run_calendar_event (google_event_id);
    CREATE INDEX IF NOT EXISTS crce_course_run_idx ON course_run_calendar_event (course_run_id);
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

export default pool;
