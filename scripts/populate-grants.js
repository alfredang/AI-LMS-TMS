/**
 * Populate ssg_grants table from SSG Grant Search API
 *
 * Fetches all grants for Tertiary Infotech (by UEN) from newest to oldest,
 * stopping when grants are older than 2025. Upserts into ssg_grants table.
 *
 * Usage: node scripts/populate-grants.js
 * Resume: RESUME_PAGE=5 node scripts/populate-grants.js
 * Requires: .env.local with DATABASE_URL, CERT_1_CERT, CERT_1_KEY, CERT_1_ENCRYPTION_KEY
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');

// Load .env.local
require('dotenv').config({ path: '.env.local' });

// --- Config ---
const SSG_API_BASE = 'https://api.ssg-wsg.sg';
const UEN = '201200696W';
const PARTNER_CODE = '201200696W-01';
const IV = Buffer.from('SSGAPIInitVector', 'utf8');
const PAGE_SIZE = 100;
const DELAY_MS = 3000; // 3 seconds between API calls
const CUTOFF_YEAR = parseInt(process.env.CUTOFF_YEAR || '2025', 10); // Stop when grants are older than this
const REQUEST_TIMEOUT = 90000; // 90 seconds per API call (SSG averages ~57s)
const RESUME_PAGE = process.env.RESUME_PAGE ? parseInt(process.env.RESUME_PAGE, 10) : 0;
const MAX_PAGES = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : 0; // 0 = unlimited

// --- DB ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

// --- Load credentials from env ---
function loadCredentials() {
  const cert = process.env.CERT_1_CERT;
  const key = process.env.CERT_1_KEY;
  const encryptionKey = process.env.CERT_1_ENCRYPTION_KEY;

  if (!cert) throw new Error('Missing CERT_1_CERT in .env.local');
  if (!key) throw new Error('Missing CERT_1_KEY in .env.local');
  if (!encryptionKey) throw new Error('Missing CERT_1_ENCRYPTION_KEY in .env.local');

  console.log('✅ Credentials loaded');
  return { cert, key, encryptionKey };
}

// --- AES-256-CBC encrypt ---
function encryptPayload(encryptionKey, payload) {
  const plaintext = JSON.stringify(payload);
  const keyBuffer = Buffer.from(encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, IV);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('base64');
}

// --- AES-256-CBC decrypt ---
function decryptResponse(encryptionKey, ciphertext) {
  const keyBuffer = Buffer.from(encryptionKey, 'base64');
  const decodedCiphertext = Buffer.from(ciphertext.replace(/\s/g, ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, IV);
  let decrypted = decipher.update(decodedCiphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// --- HTTPS request with mTLS ---
function makeRequest(url, method, headers, body, cert, key) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      cert,
      key,
      rejectUnauthorized: false
    };

    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    options.timeout = REQUEST_TIMEOUT;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT / 1000}s`));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- Sleep helper ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Extract year from grant reference (e.g. GRN-2603-140286 → 2026) ---
function getGrantYear(referenceNumber) {
  // Format: GRN-YYMM-NNNNNN — first 2 digits after GRN- are the year
  const match = referenceNumber.match(/^GRN-(\d{2})/);
  if (match) {
    return 2000 + parseInt(match[1], 10);
  }
  return null;
}

// --- Upsert a grant into ssg_grants ---
async function upsertGrant(grant) {
  const query = `
    INSERT INTO ssg_grants (
      id, grant_id, enrollment_id, status,
      funding_scheme_code, funding_scheme_description,
      component_code, component_description,
      estimated_grant_amount, approved_grant_amount,
      api_response, created_date, imported_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3,
      $4, $5, $6, $7, $8, $9, $10,
      NOW(), NOW()
    )
    ON CONFLICT (grant_id) DO UPDATE SET
      status = EXCLUDED.status,
      estimated_grant_amount = EXCLUDED.estimated_grant_amount,
      approved_grant_amount = EXCLUDED.approved_grant_amount,
      api_response = EXCLUDED.api_response,
      imported_at = NOW()
  `;

  const values = [
    grant.referenceNumber,                          // grant_id
    grant.enrolment?.referenceNumber || null,        // enrollment_id
    grant.status,                                    // status
    grant.fundingScheme?.code || null,               // funding_scheme_code
    grant.fundingScheme?.description || null,         // funding_scheme_description
    grant.fundingComponent?.code || null,             // component_code
    grant.fundingComponent?.description || null,      // component_description
    grant.grantAmount?.estimated ?? null,              // estimated_grant_amount
    grant.grantAmount?.paid ?? null,                  // approved_grant_amount
    JSON.stringify(grant),                           // api_response
  ];

  await pool.query(query, values);
}

// --- Check if grant_id has a unique constraint (needed for ON CONFLICT) ---
async function ensureUniqueConstraint() {
  // Check if unique index exists on grant_id
  const result = await pool.query(`
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ssg_grants'
      AND indexdef LIKE '%grant_id%'
      AND indexdef LIKE '%UNIQUE%';
  `);

  if (result.rows.length === 0) {
    console.log('⚠️  Adding unique constraint on ssg_grants.grant_id...');
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ssg_grants_grant_id_unique ON ssg_grants (grant_id);
    `);
    console.log('✅ Unique constraint added');
  } else {
    console.log('✅ Unique constraint on grant_id already exists');
  }
}

// --- Fetch one page of grants ---
async function fetchPage(creds, page) {
  const payload = {
    grants: {
      trainingPartner: {
        uen: UEN,
        code: PARTNER_CODE
      }
    },
    parameters: {
      page,
      pageSize: PAGE_SIZE
    }
  };

  const encryptedPayload = encryptPayload(creds.encryptionKey, payload);

  const response = await makeRequest(
    `${SSG_API_BASE}/tpg/grants/search`,
    'POST',
    { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    encryptedPayload,
    creds.cert,
    creds.key
  );

  if (response.status !== 200) {
    throw new Error(`SSG API returned ${response.status}`);
  }

  // Response may be raw encrypted text or JSON-wrapped
  let encryptedData = response.data;
  try {
    const parsed = JSON.parse(response.data);
    if (parsed.data && typeof parsed.data === 'string') {
      encryptedData = parsed.data;
    } else if (parsed.error && Object.keys(parsed.error).length > 0) {
      throw new Error(`SSG API error: ${JSON.stringify(parsed.error)}`);
    }
  } catch (e) {
    if (e.message.startsWith('SSG API error')) throw e;
    // Not JSON — raw encrypted text, use as-is
  }

  return decryptResponse(creds.encryptionKey, encryptedData);
}

// --- Main ---
async function main() {
  console.log('=== SSG Grant Population Script ===');
  console.log(`Config: pageSize=${PAGE_SIZE}, delay=${DELAY_MS}ms, timeout=${REQUEST_TIMEOUT / 1000}s, cutoff=<${CUTOFF_YEAR}`);
  if (RESUME_PAGE > 0) console.log(`Resuming from page ${RESUME_PAGE}`);
  console.log('');

  const creds = loadCredentials();
  await ensureUniqueConstraint();

  let page = RESUME_PAGE;
  let totalInserted = 0;
  let totalSkipped = 0;
  let reachedCutoff = false;
  let totalRecords = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  // Validate DB connection
  await pool.query('SELECT 1');
  console.log('✅ Database connected');

  console.log('\n--- Starting fetch ---\n');

  while (true) {
    try {
      console.log(`📄 Fetching page ${page}...`);
      const decrypted = await fetchPage(creds, page);
      retryCount = 0; // Reset on success

      // Extract grants and metadata
      const grants = decrypted.data || [];
      if (totalRecords === null && decrypted.meta?.totalRecords) {
        totalRecords = decrypted.meta.totalRecords;
        console.log(`📊 Total records in SSG: ${totalRecords}`);
      }

      if (grants.length === 0) {
        console.log('✅ No more grants — reached end of results');
        break;
      }

      // Process each grant
      let pageInserted = 0;
      let pageSkipped = 0;

      for (const grant of grants) {
        const year = getGrantYear(grant.referenceNumber);

        // Stop if we've gone past the cutoff year
        if (year !== null && year < CUTOFF_YEAR) {
          console.log(`\n🛑 Hit grant ${grant.referenceNumber} (year ${year}) — older than ${CUTOFF_YEAR}, stopping.`);
          reachedCutoff = true;
          break;
        }

        try {
          await upsertGrant(grant);
          pageInserted++;
          totalInserted++;
        } catch (dbErr) {
          console.log(`   ⚠️  Failed to upsert ${grant.referenceNumber}: ${dbErr.message}`);
          pageSkipped++;
          totalSkipped++;
        }
      }

      // Summary for this page
      const statuses = {};
      for (const g of grants) {
        statuses[g.status] = (statuses[g.status] || 0) + 1;
      }
      const statusStr = Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(', ');
      const estimatedTotal = grants.reduce((sum, g) => sum + (g.grantAmount?.estimated || 0), 0);

      console.log(`   ✅ Page ${page}: ${pageInserted} inserted, ${pageSkipped} skipped | ${statusStr} | Est total: $${estimatedTotal.toLocaleString()}`);

      if (reachedCutoff) break;

      // Check if this was the last page
      if (grants.length < PAGE_SIZE) {
        console.log('\n✅ Last page reached (fewer results than page size)');
        break;
      }

      // Check max pages limit
      const pagesFetched = page - RESUME_PAGE + 1;
      if (MAX_PAGES > 0 && pagesFetched >= MAX_PAGES) {
        console.log(`\n✅ Reached MAX_PAGES limit (${MAX_PAGES} pages)`);
        break;
      }

      // Wait before next page
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
      // Retry the same page
    }
  }

  // Final summary
  console.log('\n=== DONE ===');
  console.log(`Total grants inserted/updated: ${totalInserted}`);
  console.log(`Total skipped (errors): ${totalSkipped}`);
  console.log(`Pages fetched: ${page + 1}`);
  if (reachedCutoff) {
    console.log(`Stopped at cutoff year: ${CUTOFF_YEAR}`);
  }

  // Show DB totals
  try {
    const dbResult = await pool.query(`
      SELECT
        status,
        COUNT(*) AS count,
        COALESCE(SUM(estimated_grant_amount), 0) AS total_estimated,
        COALESCE(SUM(approved_grant_amount), 0) AS total_paid
      FROM ssg_grants
      GROUP BY status
      ORDER BY count DESC;
    `);
    console.log('\n📊 Database summary:');
    console.log('Status                  | Count | Estimated    | Paid');
    console.log('------------------------|-------|-------------|----------');
    for (const row of dbResult.rows) {
      const status = row.status.padEnd(24);
      const count = String(row.count).padStart(5);
      const est = ('$' + Number(row.total_estimated).toLocaleString()).padStart(13);
      const paid = ('$' + Number(row.total_paid).toLocaleString()).padStart(10);
      console.log(`${status}|${count} |${est} |${paid}`);
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
