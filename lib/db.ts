import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { ensureColumns } from './dbSchemaGuard';

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

// Auto-migrations, run on every startup. Columns are added only when the catalog shows them
// missing, with a lock timeout — a plain `ADD COLUMN IF NOT EXISTS` locks the table even when the
// column exists and queues every query behind any long-running read (see lib/dbSchemaGuard.ts).
const warnAutoMigration = (err: Error) => {
  console.warn('Auto-migration warning:', err.message);
};

ensureColumns(pool, 'da_application', {
  invoice_doc_number: 'text',
  invoice_drive_file_id: 'text',
  invoice_drive_web_view_link: 'text',
  grant_invoice_drive_file_id: 'text',
  grant_invoice_drive_web_view_link: 'text',
  sfc_invoice_drive_file_id: 'text',
  sfc_invoice_drive_web_view_link: 'text',
  grant_invoice_id: 'character varying(100)',
  sfc_invoice_id: 'character varying(100)',
}).catch(warnAutoMigration);

ensureColumns(pool, 'training_provider', {
  show_lesson_plan_learner_view: 'boolean DEFAULT false NOT NULL',
  show_certificate_delivery: 'boolean DEFAULT false NOT NULL',
  certificate_delivery_label: "text DEFAULT 'TP Course Evaluation' NOT NULL",
  certificate_delivery_link: "text DEFAULT 'https://goo.gl/R2eumq' NOT NULL",
})
  .then(() =>
    pool.query(`
      UPDATE training_provider
        SET show_certificate_delivery = true,
            certificate_delivery_label = 'Certificate of Achievement'
        WHERE uen = '201200696W'
          AND certificate_delivery_label IN ('TP Course Evaluation', 'Certificate Delivery');
    `)
  )
  .catch(warnAutoMigration);

// Optional courseware links shown on the Learner/Trainer class page.
// See database/migrations/add_course_lab_simulator_and_practice_exam_url.sql;
// github_url is the developer-only GitHub repository link (add_course_github_url.sql).
ensureColumns(pool, 'course', {
  lab_simulator_url: 'text',
  practice_exam_url: 'text',
  github_url: 'text',
}).catch(warnAutoMigration);

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

// Server-side sessions for real (non-forgeable) auth tokens.
// See database/migrations/create_user_session.sql.
pool
  .query(`
    CREATE TABLE IF NOT EXISTS user_session (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      token_hash   text NOT NULL UNIQUE,
      created_at   timestamptz NOT NULL DEFAULT now(),
      expires_at   timestamptz NOT NULL,
      last_used_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session (user_id);
    CREATE INDEX IF NOT EXISTS user_session_expires_idx ON user_session (expires_at);
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

// Assessor sign-off on learner assessment submissions (trainer name / NRIC /
// date / drawn signature stamped onto submitted PDF/DOCX files).
// See database/migrations/add_assessor_signature.sql.
pool
  .query(`
    CREATE TABLE IF NOT EXISTS trainer_assessor_signature (
      user_id        uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
      assessor_name  text NOT NULL,
      nric           text NOT NULL DEFAULT '',
      sign_date      date NOT NULL DEFAULT CURRENT_DATE,
      signature_png  text,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

ensureColumns(pool, 'link_assessment_submission', {
  assessor_signed_at: 'timestamptz',
  assessor_signed_by: 'uuid',
  original_file_url: 'text',
  original_file_name: 'character varying(255)',
  drive_folder_id: 'text',
}).catch(warnAutoMigration);

// Assessment Summary Record e-signing (learner + trainer blocks, generated PDF).
// See database/migrations/add_assessment_summary_signature.sql.
pool
  .query(`
    CREATE TABLE IF NOT EXISTS learner_signature (
      user_id        uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
      learner_name   text NOT NULL,
      nric           text NOT NULL DEFAULT '',
      signature_png  text,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS assessment_summary_record (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_run_id          uuid NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
      learner_user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      learner_name           text,
      learner_nric           text,
      learner_sign_date      date,
      learner_signature_png  text,
      learner_signed_at      timestamptz,
      trainer_user_id        uuid REFERENCES app_user(id) ON DELETE SET NULL,
      trainer_name           text,
      trainer_nric           text,
      trainer_sign_date      date,
      trainer_signature_png  text,
      trainer_signed_at      timestamptz,
      template_file_id       text,
      file_id                text,
      file_url               text,
      file_name              character varying(255),
      generated_at           timestamptz,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT assessment_summary_record_run_learner_key UNIQUE (course_run_id, learner_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_summary_record_run ON assessment_summary_record (course_run_id);
  `)
  .catch((err) => {
    console.warn('Auto-migration warning:', err.message);
  });

export default pool;
