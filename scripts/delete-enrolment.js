/* eslint-disable no-console */
const { Pool } = require('pg');
const path = require('path');

// Load env like Next dev does (.env.local first)
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config({ path: path.join(process.cwd(), '.env') });
} catch {
  // ignore
}

async function main() {
  const enr = String(process.argv[2] || '').trim();
  if (!enr) {
    console.error('Usage: node scripts/delete-enrolment.js ENR-xxxx');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' || url.includes('supabase') ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const norm = enr;
    const counts = {};

    async function del(sql, params, key) {
      const r = await client.query(sql, params);
      counts[key] = r.rowCount;
    }

    // Delete in safe order (dependent → parent)
    await del(
      `DELETE FROM public.invoice_jobs
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'invoice_jobs'
    );

    await del(
      `DELETE FROM public.ssg_claims
       WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'ssg_claims'
    );

    await del(
      `DELETE FROM public.ssg_grants
       WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'ssg_grants'
    );

    await del(
      `DELETE FROM public.ssg_enrolments
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'ssg_enrolments'
    );

    // Any DA rows matching this ENR (cleanup only)
    await del(
      `DELETE FROM public.da_application
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'da_application'
    );

    // Local enrollment row (cascades to assessment/submissions/etc via FK on enrollment.id)
    await del(
      `DELETE FROM public.enrollment
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [norm],
      'enrollment'
    );

    await client.query('COMMIT');
    console.log(`[delete-enrolment] Deleted for ${enr}:`, counts);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[delete-enrolment] Failed:', e);
    process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

