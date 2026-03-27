/**
 * Sync ssg_enrolments → enrollment table
 *
 * Enriches the main enrollment table with SSG data where enrolment_id matches.
 * No SSG API calls — works purely from local DB data already in ssg_enrolments.
 * Safe to re-run (idempotent updates).
 *
 * Usage: node scripts/sync-enrolments.js
 *
 * Requires: .env.local with DATABASE_URL
 */

const { pool } = require('./ssg-enrolment-utils');

async function syncToEnrollmentTable() {
  console.log('=== Sync ssg_enrolments → enrollment ===\n');

  await pool.query('SELECT 1');
  console.log('✅ Database connected');

  // Check how many ssg_enrolments exist
  const ssgCount = await pool.query('SELECT COUNT(*) AS count FROM ssg_enrolments');
  console.log(`📊 ssg_enrolments rows: ${ssgCount.rows[0].count}`);

  // Show what will match before updating
  const previewResult = await pool.query(`
    SELECT
      COUNT(*) AS total_matches,
      COUNT(CASE WHEN e.enrolment_status IS DISTINCT FROM se.enrolment_status THEN 1 END) AS status_changes,
      COUNT(CASE WHEN e.nric IS NULL AND se.trainee_nric IS NOT NULL THEN 1 END) AS nric_fills,
      COUNT(CASE WHEN e.raw_data IS NULL AND se.raw_data IS NOT NULL THEN 1 END) AS raw_data_fills
    FROM enrollment e
    JOIN ssg_enrolments se ON e.enrolment_id = se.enrolment_id
    WHERE se.enrolment_id IS NOT NULL;
  `);
  const preview = previewResult.rows[0];
  console.log(`\n🔍 Preview:`);
  console.log(`   Matching rows: ${preview.total_matches}`);
  console.log(`   Status changes: ${preview.status_changes}`);
  console.log(`   NRIC fills: ${preview.nric_fills}`);
  console.log(`   raw_data fills: ${preview.raw_data_fills}`);

  if (parseInt(preview.total_matches) === 0) {
    console.log('\n⚠️  No matching enrolment_id between enrollment and ssg_enrolments.');
    console.log('   This means the main enrollment rows don\'t have SSG enrolment IDs set.');
    console.log('   You may need to match by other fields (NRIC + course_run_id).');

    // Try matching by NRIC + course_run_id as fallback
    const altMatchResult = await pool.query(`
      SELECT COUNT(*) AS alt_matches
      FROM enrollment e
      JOIN ssg_enrolments se
        ON e.nric = se.trainee_nric
        AND e.course_run_id::text IN (
          SELECT cr.id::text FROM course_run cr WHERE cr.course_run_id = se.course_run_id
        )
      WHERE se.trainee_nric IS NOT NULL;
    `);
    const altMatches = parseInt(altMatchResult.rows[0].alt_matches);
    if (altMatches > 0) {
      console.log(`\n💡 Found ${altMatches} potential matches by NRIC + course_run_id.`);
      console.log('   Syncing these instead...\n');

      const altResult = await pool.query(`
        UPDATE enrollment e
        SET
          enrolment_id = se.enrolment_id,
          enrolment_status = COALESCE(se.enrolment_status, e.enrolment_status),
          raw_data = COALESCE(se.raw_data, e.raw_data),
          course_sponsorship = CASE
            WHEN LOWER(se.sponsorship_type) = 'employer' THEN 'Employer'::course_sponsorship
            WHEN LOWER(se.sponsorship_type) = 'individual' THEN 'Individual'::course_sponsorship
            ELSE e.course_sponsorship
          END
        FROM ssg_enrolments se
        JOIN course_run cr ON cr.course_run_id = se.course_run_id
        WHERE e.nric = se.trainee_nric
          AND e.course_run_id = cr.id
          AND se.trainee_nric IS NOT NULL
        RETURNING e.id, e.enrolment_id, se.enrolment_status;
      `);

      console.log(`✅ Updated ${altResult.rowCount} enrollment rows (matched by NRIC + course_run_id)`);
      if (altResult.rowCount > 0) {
        printStatusBreakdown(altResult.rows);
      }
    }

    await showSummary();
    await pool.end();
    return;
  }

  // Primary sync: match by enrolment_id
  console.log('\n--- Syncing by enrolment_id ---\n');

  const result = await pool.query(`
    UPDATE enrollment e
    SET
      enrolment_status = se.enrolment_status,
      raw_data = se.raw_data,
      nric = COALESCE(se.trainee_nric, e.nric),
      course_sponsorship = CASE
        WHEN LOWER(se.sponsorship_type) = 'employer' THEN 'Employer'::course_sponsorship
        WHEN LOWER(se.sponsorship_type) = 'individual' THEN 'Individual'::course_sponsorship
        ELSE e.course_sponsorship
      END
    FROM ssg_enrolments se
    WHERE e.enrolment_id = se.enrolment_id
      AND se.enrolment_id IS NOT NULL
    RETURNING e.id, e.enrolment_id, se.enrolment_status;
  `);

  console.log(`✅ Updated ${result.rowCount} enrollment rows from SSG data`);
  if (result.rowCount > 0) {
    printStatusBreakdown(result.rows);
  }

  await showSummary();
  await pool.end();
}

function printStatusBreakdown(rows) {
  const statuses = {};
  for (const row of rows) {
    statuses[row.enrolment_status] = (statuses[row.enrolment_status] || 0) + 1;
  }
  console.log('   Status breakdown:', Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(', '));
}

async function showSummary() {
  try {
    const matchResult = await pool.query(`
      SELECT COUNT(*) AS matched
      FROM enrollment e
      JOIN ssg_enrolments se ON e.enrolment_id = se.enrolment_id
      WHERE se.enrolment_id IS NOT NULL;
    `);
    console.log(`\n🔗 Main enrollment rows now linked to SSG data: ${matchResult.rows[0].matched}`);

    const traineeResult = await pool.query(`
      SELECT
        cr.course_run_id,
        c.title,
        COUNT(DISTINCT se.id) AS ssg_enrolments,
        COUNT(DISTINCT e.id) AS local_enrolments
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN ssg_enrolments se ON se.course_run_id = cr.course_run_id
      LEFT JOIN enrollment e ON e.course_run_id = cr.id
      GROUP BY cr.course_run_id, c.title
      HAVING COUNT(DISTINCT se.id) > 0 OR COUNT(DISTINCT e.id) > 0
      ORDER BY ssg_enrolments DESC
      LIMIT 10;
    `);
    if (traineeResult.rows.length > 0) {
      console.log('\n📊 Top course runs (SSG vs local enrolments):');
      console.log('Run ID    | SSG | Local | Course');
      console.log('----------|-----|-------|-------');
      for (const row of traineeResult.rows) {
        const runId = (row.course_run_id || '').padEnd(10);
        const ssg = String(row.ssg_enrolments).padStart(3);
        const local = String(row.local_enrolments).padStart(5);
        console.log(`${runId}| ${ssg} | ${local} | ${row.title}`);
      }
    }
  } catch (e) {
    console.log('Could not query summary:', e.message);
  }

  console.log('\n=== DONE ===');
}

syncToEnrollmentTable().catch(async (err) => {
  console.error('Fatal error:', err);
  await pool.end();
  process.exit(1);
});
