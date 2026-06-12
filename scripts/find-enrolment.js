/* eslint-disable no-console */
const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config({ path: path.join(process.cwd(), '.env') });
} catch {
  // ignore
}

const { Pool } = require('pg');

async function main() {
  const term = String(process.argv[2] || '').trim();
  if (!term) {
    console.error('Usage: node scripts/find-enrolment.js <searchTerm>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('supabase')
        ? { rejectUnauthorized: false }
        : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const like = `%${term}%`;
  const q1 = await pool.query(
    `SELECT enrolment_id, trainee_name, trainee_nric, imported_at
     FROM ssg_enrolments
     WHERE trainee_name ILIKE $1 OR enrolment_id ILIKE $1 OR trainee_nric ILIKE $1
     ORDER BY imported_at DESC NULLS LAST, created_date DESC NULLS LAST
     LIMIT 20`,
    [like]
  );

  const q2 = await pool.query(
    `SELECT enrollment_id, grant_id, status, funding_scheme_description, imported_at
     FROM ssg_grants
     WHERE enrollment_id ILIKE $1 OR grant_id ILIKE $1 OR funding_scheme_description ILIKE $1
     ORDER BY imported_at DESC NULLS LAST, created_date DESC NULLS LAST
     LIMIT 20`,
    [like]
  );

  const q3 = await pool.query(
    `SELECT id, user_id, enrolment_id, enrolment_status, created_at
     FROM enrollment
     WHERE enrolment_id ILIKE $1 OR nric ILIKE $1 OR email ILIKE $1
     ORDER BY created_at DESC NULLS LAST
     LIMIT 20`,
    [like]
  );

  const q4 = await pool.query(
    `SELECT enrolment_id, status, qbo_invoice_id, invoice_no, learner_email, drive_web_view_link, invoice_sent_at, updated_at
     FROM public.invoice_jobs
     WHERE enrolment_id ILIKE $1 OR qbo_invoice_id ILIKE $1 OR invoice_no ILIKE $1 OR learner_email ILIKE $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 20`,
    [like]
  );

  console.log('ssg_enrolments:', q1.rows);
  console.log('ssg_grants:', q2.rows);
  console.log('enrollment:', q3.rows);
  console.log('invoice_jobs:', q4.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

