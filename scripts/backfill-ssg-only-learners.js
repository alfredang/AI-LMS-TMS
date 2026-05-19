/* eslint-disable */
/**
 * Backfill app_user / learner_profile / user_role_map for SSG-only enrolments
 * (rows in ssg_enrolments whose trainee email has no matching app_user).
 *
 * This is the one-off counterpart to the runtime fix in
 * `lib/services/invoiceJobs.ts → ensureLearnerUserFromSsgRecord`.
 *
 * Usage:
 *   node scripts/backfill-ssg-only-learners.js          # dry-run (shows what would change)
 *   node scripts/backfill-ssg-only-learners.js --apply  # actually create the rows
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

function nameFromEmail(email) {
  const local = email.split('@')[0] ?? email;
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickEmail(raw) {
  const e = raw?.trainee?.email;
  if (typeof e === 'string') return e.trim();
  if (e && typeof e.full === 'string') return e.full.trim();
  return '';
}
function pickName(raw) {
  const n = raw?.trainee?.fullName;
  return typeof n === 'string' ? n.trim() : '';
}
function pickNric(raw) {
  const t = raw?.trainee;
  if (!t) return '';
  if (typeof t.id === 'string' && t.id.trim()) return t.id.trim();
  if (typeof t.idNumber === 'string' && t.idNumber.trim()) return t.idNumber.trim();
  return '';
}

async function provisionLearner(client, { email, fullName, nric }) {
  const recheck = await client.query(
    `SELECT id FROM app_user WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  if (recheck.rows[0]?.id) return { userId: recheck.rows[0].id, created: false };

  const placeholderPwd = `ssg_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ins = await client.query(
    `INSERT INTO app_user (email, password, password_hash, full_name)
     VALUES ($1, $2, $2, $3)
     RETURNING id`,
    [email, placeholderPwd, fullName || nameFromEmail(email)]
  );
  const userId = ins.rows[0].id;

  await client.query(
    `INSERT INTO learner_profile (user_id, tel, nric)
     VALUES ($1, '', $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, nric || null]
  );

  await client.query(
    `INSERT INTO user_role_map (user_id, role)
     VALUES ($1, 'Learner')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId]
  );

  return { userId, created: true };
}

(async () => {
  // Pull every Confirmed SSG enrolment whose trainee email has no matching app_user.
  // (Cancelled enrolments aren't billable, so skip them.)
  const rows = await pool.query(
    `SELECT s.enrolment_id::text                       AS enrolment_id,
            s.course_reference::text                   AS course_reference,
            s.raw_data->'trainee'->'email'->>'full'    AS email_full,
            s.raw_data->'trainee'->>'fullName'         AS full_name,
            s.raw_data->'trainee'->>'id'               AS nric_id,
            s.raw_data                                 AS raw_data
     FROM ssg_enrolments s
     WHERE LOWER(TRIM(COALESCE(s.enrolment_status::text, ''))) = 'confirmed'
       AND COALESCE(s.raw_data->'trainee'->'email'->>'full', '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM app_user u
         WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(s.raw_data->'trainee'->'email'->>'full'))
       )
     ORDER BY s.enrolment_id`
  );

  // De-dup by email — many enrolments may share one learner.
  const byEmail = new Map();
  for (const r of rows.rows) {
    const email = pickEmail(r.raw_data) || (r.email_full || '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        email,
        fullName: pickName(r.raw_data) || r.full_name || '',
        nric: pickNric(r.raw_data) || r.nric_id || '',
        sampleEnrolment: r.enrolment_id,
        courseRefs: new Set([r.course_reference].filter(Boolean)),
      });
    } else {
      const existing = byEmail.get(key);
      if (r.course_reference) existing.courseRefs.add(r.course_reference);
    }
  }

  console.log(`Found ${rows.rowCount} confirmed enrolments → ${byEmail.size} unique learners to provision\n`);
  if (byEmail.size === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to actually create app_user / learner_profile / user_role_map rows.\n');
    for (const v of byEmail.values()) {
      console.log(
        `  ${v.email.padEnd(40)}  ${v.fullName || '(name from email)'}  nric=${v.nric || '-'}  enrolments=${[...v.courseRefs].length || 0}`
      );
    }
    await pool.end();
    return;
  }

  // Apply
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const v of byEmail.values()) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await provisionLearner(client, { email: v.email, fullName: v.fullName, nric: v.nric });
      await client.query('COMMIT');
      if (res.created) {
        created++;
        console.log(`  CREATED  ${v.email}  → ${res.userId}`);
      } else {
        skipped++;
        console.log(`  EXISTS   ${v.email}  (raced — already in app_user)`);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      failed++;
      console.error(`  FAILED   ${v.email}:`, err instanceof Error ? err.message : err);
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. created=${created}  already_existed=${skipped}  failed=${failed}`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
