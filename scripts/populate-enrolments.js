/**
 * Populate ssg_enrolments table from SSG Enrolment Search API
 *
 * Fetches all enrolments for Tertiary Infotech (by UEN) from SSG
 * and upserts into ssg_enrolments. Does NOT touch the main enrollment table.
 *
 * Usage:
 *   node scripts/populate-enrolments.js            # Fetch all into ssg_enrolments
 *   RESUME_PAGE=5 node scripts/populate-enrolments.js  # Resume from page 5
 *
 * To sync to main enrollment table after: node scripts/sync-enrolments.js
 * To do both in one go:                   node scripts/populate-and-sync-enrolments.js
 *
 * Requires: .env.local with DATABASE_URL, CERT_1_CERT, CERT_1_KEY, CERT_1_ENCRYPTION_KEY
 */

const { pool, loadCredentials, ensureTable, upsertEnrolment, fetchPage, sleep } = require('./ssg-enrolment-utils');

const PAGE_SIZE = 100;
const DELAY_MS = 3000;
const MAX_RETRIES = 3;
const RESUME_PAGE = process.env.RESUME_PAGE ? parseInt(process.env.RESUME_PAGE, 10) : 0;
const MAX_PAGES = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : 0; // 0 = unlimited

async function main() {
  console.log('=== SSG Enrolment Population (ssg_enrolments only) ===');
  console.log(`Config: pageSize=${PAGE_SIZE}, delay=${DELAY_MS}ms`);
  if (RESUME_PAGE > 0) console.log(`Resuming from page ${RESUME_PAGE}`);
  console.log('');

  const creds = loadCredentials();
  await ensureTable();

  await pool.query('SELECT 1');
  console.log('✅ Database connected');

  let page = RESUME_PAGE;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalRecords = null;
  let retryCount = 0;

  console.log('\n--- Starting fetch ---\n');

  while (true) {
    try {
      console.log(`📄 Fetching page ${page}...`);
      const decrypted = await fetchPage(creds, page, PAGE_SIZE);
      retryCount = 0;

      const enrolments = decrypted.data || [];
      if (totalRecords === null && decrypted.meta?.totalRecords) {
        totalRecords = decrypted.meta.totalRecords;
        console.log(`📊 Total records in SSG: ${totalRecords}`);
      }

      if (enrolments.length === 0) {
        console.log('✅ No more enrolments — reached end of results');
        break;
      }

      let pageInserted = 0;
      let pageSkipped = 0;

      for (const enrolment of enrolments) {
        try {
          await upsertEnrolment(enrolment);
          pageInserted++;
          totalInserted++;
        } catch (dbErr) {
          const refNum = (enrolment.enrolment || enrolment).referenceNumber || 'unknown';
          console.log(`   ⚠️  Failed to upsert ${refNum}: ${dbErr.message}`);
          pageSkipped++;
          totalSkipped++;
        }
      }

      const statuses = {};
      for (const e of enrolments) {
        const rec = (e.enrolment || e);
        statuses[rec.status] = (statuses[rec.status] || 0) + 1;
      }
      const statusStr = Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(', ');
      console.log(`   ✅ Page ${page}: ${pageInserted} inserted, ${pageSkipped} skipped | ${statusStr}`);

      if (enrolments.length < PAGE_SIZE) {
        console.log('\n✅ Last page reached (fewer results than page size)');
        break;
      }

      // Check max pages limit
      const pagesFetched = page - RESUME_PAGE + 1;
      if (MAX_PAGES > 0 && pagesFetched >= MAX_PAGES) {
        console.log(`\n✅ Reached MAX_PAGES limit (${MAX_PAGES} pages)`);
        break;
      }

      // NOTE: SSG caps totalRecords to pageSize — do NOT use it as a stop condition.
      // Only stop when a page returns fewer results than pageSize or returns empty.

      page++;
      console.log(`   ⏳ Waiting ${DELAY_MS / 1000}s before next page...`);
      await sleep(DELAY_MS);

    } catch (err) {
      retryCount++;
      console.error(`\n❌ Error on page ${page} (attempt ${retryCount}/${MAX_RETRIES}): ${err.message}`);
      if (retryCount >= MAX_RETRIES) {
        console.error(`🛑 Max retries reached for page ${page}. Stopping.`);
        break;
      }
      console.log('   Waiting 30s before retrying...');
      await sleep(30000);
    }
  }

  // Summary
  console.log('\n=== DONE ===');
  console.log(`Total enrolments inserted/updated: ${totalInserted}`);
  console.log(`Total skipped (errors): ${totalSkipped}`);
  console.log(`Pages fetched: ${page + 1}`);

  try {
    const dbResult = await pool.query(`
      SELECT enrolment_status, COUNT(*) AS count
      FROM ssg_enrolments
      GROUP BY enrolment_status
      ORDER BY count DESC;
    `);
    console.log('\n📊 ssg_enrolments summary:');
    console.log('Status          | Count');
    console.log('----------------|------');
    for (const row of dbResult.rows) {
      const status = (row.enrolment_status || 'NULL').padEnd(16);
      const count = String(row.count).padStart(5);
      console.log(`${status}|${count}`);
    }
  } catch (e) {
    console.log('Could not query DB summary:', e.message);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await pool.end();
  process.exit(1);
});
