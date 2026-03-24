/**
 * Populate ssg_claims table from TPGateway Claims Report XLSX exports
 *
 * Reads all "Report Details_*.xlsx" files from .project/more-context/,
 * parses claim records, and upserts into ssg_claims table.
 *
 * Usage: node scripts/populate-claims-csv.js
 * Requires: .env.local with DATABASE_URL
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env.local
require('dotenv').config({ path: '.env.local' });

// --- Config ---
const XLSX_DIR = path.join(__dirname, '..', '.project', 'more-context');
const XLSX_PATTERN = /^Report Details_.*\.xlsx$/;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500; // 500ms between batches to avoid overwhelming shared DB pool
const TRAINING_PARTNER_CODE = '201200696W-01';

// --- DB ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

// --- Parse date string (DD/MM/YYYY) to ISO date or null ---
function parseDate(dateStr) {
  if (!dateStr || dateStr === '---' || dateStr === '') return null;
  const str = String(dateStr).trim();
  // DD/MM/YYYY format
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`);
  }
  // Try direct parse as fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// --- Parse claim amount (remove $ and commas) ---
function parseAmount(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[$,S]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// --- Map "Paid" status from xlsx to "Disbursed" (TPGateway uses both) ---
function normalizeStatus(status) {
  if (!status) return null;
  const s = String(status).trim();
  if (s === 'Paid') return 'Disbursed';
  return s;
}

// --- Ensure unique constraint on claim_id ---
async function ensureUniqueConstraint() {
  const result = await pool.query(`
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ssg_claims'
      AND indexdef LIKE '%claim_id%'
      AND indexdef LIKE '%UNIQUE%';
  `);

  if (result.rows.length === 0) {
    console.log('Adding unique constraint on ssg_claims.claim_id...');
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ssg_claims_claim_id_unique ON ssg_claims (claim_id);
    `);
    console.log('Unique constraint added');
  } else {
    console.log('Unique constraint on claim_id already exists');
  }
}

// --- Upsert a batch of claims ---
async function upsertBatch(claims) {
  if (claims.length === 0) return 0;

  // Build multi-row INSERT with ON CONFLICT
  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const c of claims) {
    placeholders.push(`(
      gen_random_uuid(), $${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2},
      $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5},
      $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8},
      NOW(), NOW(), $${paramIndex + 9}
    )`);
    values.push(
      String(c.claimId),           // claim_id
      c.enrollmentId,              // enrollment_id (null — not in claims export)
      c.traineeName,               // trainee_name
      c.courseReference,            // course_reference
      TRAINING_PARTNER_CODE,       // training_partner_code
      c.claimStatus,               // claim_status
      c.claimAmount,               // claim_amount
      c.disbursementDate,          // payment_date
      c.readyForPayoutDate,        // submission_date (closest proxy)
      JSON.stringify(c.rawData),   // raw_data
    );
    paramIndex += 10;
  }

  const query = `
    INSERT INTO ssg_claims (
      id, claim_id, enrollment_id, trainee_name,
      course_reference, training_partner_code, claim_status,
      claim_amount, payment_date, submission_date,
      created_date, imported_at, raw_data
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (claim_id) DO UPDATE SET
      claim_status = EXCLUDED.claim_status,
      claim_amount = EXCLUDED.claim_amount,
      payment_date = EXCLUDED.payment_date,
      submission_date = EXCLUDED.submission_date,
      raw_data = EXCLUDED.raw_data,
      imported_at = NOW()
  `;

  const result = await pool.query(query, values);
  return result.rowCount;
}

// --- Read and parse one xlsx file ---
function parseXlsx(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  return rows.map(row => ({
    claimId: row['Claim Id'],
    traineeName: row['Individual Name'] || null,
    courseReference: row['Course Reference Number'] || null,
    claimStatus: normalizeStatus(row['Claim Status']),
    claimAmount: parseAmount(row['Claim Amount']),
    disbursementDate: parseDate(row['Disbursement Date']),
    readyForPayoutDate: parseDate(row['Ready For Payout Date']),
    enrollmentId: null, // Not in claims export
    rawData: row,
  }));
}

// --- Main ---
async function main() {
  console.log('=== SSG Claims Population (from TPGateway XLSX exports) ===\n');

  // Find xlsx files
  const files = fs.readdirSync(XLSX_DIR)
    .filter(f => XLSX_PATTERN.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No Report Details xlsx files found in', XLSX_DIR);
    process.exit(1);
  }
  console.log(`Found ${files.length} xlsx files\n`);

  // Validate DB
  await pool.query('SELECT 1');
  console.log('Database connected');
  await ensureUniqueConstraint();

  // Parse all files
  const allClaims = [];
  const seenClaimIds = new Set();

  for (const f of files) {
    const filePath = path.join(XLSX_DIR, f);
    const claims = parseXlsx(filePath);

    // Deduplicate (some files overlap)
    let dupes = 0;
    for (const c of claims) {
      if (!c.claimId) continue;
      const key = String(c.claimId);
      if (seenClaimIds.has(key)) {
        dupes++;
        continue;
      }
      seenClaimIds.add(key);
      allClaims.push(c);
    }

    const statuses = {};
    for (const c of claims) {
      const s = c.claimStatus || 'unknown';
      statuses[s] = (statuses[s] || 0) + 1;
    }
    const statusStr = Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(', ');
    console.log(`  ${f}: ${claims.length} rows (${dupes} dupes skipped) | ${statusStr}`);
  }

  console.log(`\nTotal unique claims to import: ${allClaims.length}\n`);

  // Insert in batches
  let totalInserted = 0;
  let batchNum = 0;

  for (let i = 0; i < allClaims.length; i += BATCH_SIZE) {
    const batch = allClaims.slice(i, i + BATCH_SIZE);
    batchNum++;

    try {
      const count = await upsertBatch(batch);
      totalInserted += count;
      if (batchNum % 10 === 0 || i + BATCH_SIZE >= allClaims.length) {
        console.log(`  Batch ${batchNum}: ${totalInserted}/${allClaims.length} processed`);
      }
    } catch (err) {
      console.error(`  Batch ${batchNum} failed:`, err.message);
      // Fall back to individual inserts for this batch
      for (const c of batch) {
        try {
          await upsertBatch([c]);
          totalInserted++;
        } catch (innerErr) {
          console.error(`    Failed claim ${c.claimId}: ${innerErr.message}`);
        }
      }
    }

    // Rate limit to avoid overwhelming shared DB pool
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  // Final summary
  console.log('\n=== DONE ===');
  console.log(`Total claims upserted: ${totalInserted}`);

  // DB summary
  try {
    const dbResult = await pool.query(`
      SELECT
        claim_status,
        COUNT(*) AS count,
        COALESCE(SUM(claim_amount), 0) AS total_amount
      FROM ssg_claims
      GROUP BY claim_status
      ORDER BY count DESC;
    `);
    console.log('\nDatabase summary:');
    console.log('Status                  | Count  | Total Amount');
    console.log('------------------------|--------|-------------');
    for (const row of dbResult.rows) {
      const status = (row.claim_status || 'null').padEnd(24);
      const count = String(row.count).padStart(6);
      const amount = ('$' + Number(row.total_amount).toLocaleString()).padStart(13);
      console.log(`${status}|${count} |${amount}`);
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
