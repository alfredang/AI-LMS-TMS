/**
 * Test script: Single SSG Grant Search call (UEN-only)
 *
 * Tests whether searching grants by just Training Partner UEN works
 * without specifying a course run ID.
 *
 * Usage: node scripts/test-grant-search.js
 * Requires: .env.local with CERT_1_CERT, CERT_1_KEY, CERT_1_ENCRYPTION_KEY
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

// Load .env.local
require('dotenv').config({ path: '.env.local' });

// --- Config ---
const SSG_API_BASE = 'https://api.ssg-wsg.sg';
const UEN = '201200696W';
const PARTNER_CODE = '201200696W-01';
const IV = Buffer.from('SSGAPIInitVector', 'utf8');

// --- Load credentials from env ---
function loadCredentials() {
  const cert = process.env.CERT_1_CERT;
  const key = process.env.CERT_1_KEY;
  const encryptionKey = process.env.CERT_1_ENCRYPTION_KEY;

  if (!cert) throw new Error('Missing CERT_1_CERT in .env.local');
  if (!key) throw new Error('Missing CERT_1_KEY in .env.local');
  if (!encryptionKey) throw new Error('Missing CERT_1_ENCRYPTION_KEY in .env.local');

  console.log('✅ Credentials loaded from env vars');
  console.log(`   Certificate: ${cert.substring(0, 40)}...`);
  console.log(`   Key: ${key.substring(0, 40)}...`);
  console.log(`   Encryption key length: ${Buffer.from(encryptionKey, 'base64').length} bytes`);

  return { cert, key, encryptionKey };
}

// --- AES-256-CBC encrypt (same as lib/ssg/utils/cryptography.ts) ---
function encryptPayload(encryptionKey, payload) {
  const plaintext = JSON.stringify(payload);
  const keyBuffer = Buffer.from(encryptionKey, 'base64');

  if (keyBuffer.length !== 32) {
    throw new Error(`Invalid key length: ${keyBuffer.length} bytes (expected 32)`);
  }

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

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, statusText: res.statusMessage, data });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --- Main ---
async function main() {
  console.log('=== SSG Grant Search Test (UEN-only) ===\n');

  // 1. Load credentials
  const creds = loadCredentials();
  console.log('');

  // 2. Build payload (UEN-only, no course run ID)
  const payload = {
    grants: {
      trainingPartner: {
        uen: UEN,
        code: PARTNER_CODE
      }
    },
    parameters: {
      page: 1,
      pageSize: 5
    }
  };
  console.log('📦 Payload (before encryption):');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  // 3. Encrypt payload
  const encryptedPayload = encryptPayload(creds.encryptionKey, payload);
  console.log(`🔐 Encrypted payload (${encryptedPayload.length} chars): ${encryptedPayload.substring(0, 60)}...`);
  console.log('');

  // 4. Make the API call
  const url = `${SSG_API_BASE}/tpg/grants/search`;
  console.log(`🌐 POST ${url}`);
  console.log('   Using SKILLETO certificate (CERT_1)');
  console.log('   Waiting for response...\n');

  try {
    const response = await makeRequest(
      url,
      'POST',
      {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      encryptedPayload,
      creds.cert,
      creds.key
    );

    console.log(`📡 Response status: ${response.status} ${response.statusText}`);
    console.log('');

    // 5. Try to decrypt response (may be raw encrypted string or JSON-wrapped)
    let encryptedData = response.data;

    // Check if response is JSON-wrapped
    try {
      const parsed = JSON.parse(response.data);
      if (parsed.data && typeof parsed.data === 'string') {
        encryptedData = parsed.data;
        console.log('📄 Response is JSON-wrapped, extracting encrypted data...');
      } else {
        // Response is JSON but not encrypted
        console.log('📄 Response (JSON, not encrypted):');
        console.log(JSON.stringify(parsed, null, 2));
        return;
      }
    } catch {
      // Not JSON — treat entire body as encrypted text
      console.log('🔐 Response is raw encrypted text, decrypting...');
    }

    console.log('');
    try {
      const decrypted = decryptResponse(creds.encryptionKey, encryptedData);
      console.log('✅ Decrypted response:');
      console.log(JSON.stringify(decrypted, null, 2));

      // Summary
      if (Array.isArray(decrypted)) {
        console.log(`\n📊 Results: ${decrypted.length} grants on this page`);
      } else if (decrypted.data && Array.isArray(decrypted.data)) {
        console.log(`\n📊 Results: ${decrypted.data.length} grants on this page`);
      } else if (decrypted.data && decrypted.data.grants && Array.isArray(decrypted.data.grants)) {
        console.log(`\n📊 Results: ${decrypted.data.grants.length} grants on this page`);
      }
    } catch (decryptErr) {
      console.log('❌ Decryption failed:', decryptErr.message);
      console.log('   Raw data (first 200 chars):', encryptedData.substring(0, 200));
    }

  } catch (err) {
    console.log('❌ Request failed:', err.message);
  }
}

main().catch(console.error);
