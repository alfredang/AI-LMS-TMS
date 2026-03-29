/**
 * Shared utilities for SSG enrolment scripts
 * Used by: populate-enrolments.js, sync-enrolments.js
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');

require('dotenv').config({ path: '.env.local' });

// --- Config ---
const SSG_API_BASE = 'https://api.ssg-wsg.sg';
const UEN = '201200696W';
const PARTNER_CODE = '201200696W-01';
const IV = Buffer.from('SSGAPIInitVector', 'utf8');
const REQUEST_TIMEOUT = 90000;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Ensure ssg_enrolments table exists ---
async function ensureTable() {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ssg_enrolments';
  `);

  if (result.rows.length === 0) {
    console.log('⚠️  ssg_enrolments table does not exist — creating...');
    await pool.query(`
      CREATE TABLE public.ssg_enrolments (
        id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
        enrolment_id character varying(100),
        trainee_name character varying(255),
        trainee_nric character varying(20),
        course_title character varying(255),
        course_reference character varying(100),
        course_run_id character varying(100),
        training_partner_code character varying(50),
        enrolment_status character varying(50),
        sponsorship_type character varying(50),
        enrolment_date timestamp with time zone,
        completion_date timestamp with time zone,
        created_date timestamp with time zone DEFAULT now() NOT NULL,
        imported_at timestamp with time zone DEFAULT now() NOT NULL,
        raw_data jsonb,
        CONSTRAINT ssg_enrolments_enrolment_id_key UNIQUE (enrolment_id)
      );
    `);
    console.log('✅ ssg_enrolments table created');
  } else {
    console.log('✅ ssg_enrolments table exists');
  }
}

// --- Upsert an enrolment into ssg_enrolments ---
async function upsertEnrolment(item) {
  const record = item.enrolment || item;

  const query = `
    INSERT INTO ssg_enrolments (
      enrolment_id, trainee_name, trainee_nric,
      course_title, course_reference, course_run_id,
      training_partner_code, enrolment_status, sponsorship_type,
      enrolment_date, raw_data, created_date, imported_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10::timestamptz, $11, NOW(), NOW()
    )
    ON CONFLICT (enrolment_id) DO UPDATE SET
      trainee_name = EXCLUDED.trainee_name,
      trainee_nric = EXCLUDED.trainee_nric,
      course_title = EXCLUDED.course_title,
      course_reference = EXCLUDED.course_reference,
      course_run_id = EXCLUDED.course_run_id,
      enrolment_status = EXCLUDED.enrolment_status,
      sponsorship_type = EXCLUDED.sponsorship_type,
      enrolment_date = EXCLUDED.enrolment_date,
      raw_data = EXCLUDED.raw_data,
      imported_at = NOW()
  `;

  const values = [
    record.referenceNumber,
    record.trainee?.fullName || null,
    record.trainee?.id || null,
    record.course?.title || null,
    record.course?.referenceNumber || null,
    record.course?.run?.id || null,
    record.trainingPartner?.code || null,
    record.status || null,
    record.trainee?.sponsorshipType || null,
    record.trainee?.enrolmentDate || null,
    JSON.stringify(record),
  ];

  await pool.query(query, values);
}

// --- Fetch one page of enrolments from SSG ---
async function fetchPage(creds, page, pageSize) {
  const payload = {
    enrolment: {
      trainingPartner: {
        uen: UEN,
        code: PARTNER_CODE
      }
    },
    sortBy: {
      field: 'updatedOn',
      order: 'desc'
    },
    parameters: {
      page,
      pageSize
    }
  };

  const encryptedPayload = encryptPayload(creds.encryptionKey, payload);

  const response = await makeRequest(
    `${SSG_API_BASE}/tpg/enrolments/search`,
    'POST',
    { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    encryptedPayload,
    creds.cert,
    creds.key
  );

  if (response.status !== 200) {
    throw new Error(`SSG API returned ${response.status}`);
  }

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
  }

  return decryptResponse(creds.encryptionKey, encryptedData);
}

module.exports = {
  pool,
  loadCredentials,
  ensureTable,
  upsertEnrolment,
  fetchPage,
  sleep,
  SSG_API_BASE,
  UEN,
  PARTNER_CODE,
};
