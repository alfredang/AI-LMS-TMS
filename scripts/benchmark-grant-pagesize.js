/**
 * Benchmark SSG grant search response times at different pageSizes
 * Usage: node scripts/benchmark-grant-pagesize.js
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
require('dotenv').config({ path: '.env.local' });

const SSG_API_BASE = 'https://api.ssg-wsg.sg';
const UEN = '201200696W';
const PARTNER_CODE = '201200696W-01';
const IV = Buffer.from('SSGAPIInitVector', 'utf8');

const cert = process.env.CERT_1_CERT;
const key = process.env.CERT_1_KEY;
const encryptionKey = process.env.CERT_1_ENCRYPTION_KEY;

function encrypt(payload) {
  const keyBuffer = Buffer.from(encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, IV);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('base64');
}

function makeRequest(body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(`${SSG_API_BASE}/tpg/grants/search`);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname: parsedUrl.hostname, port: 443,
      path: parsedUrl.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr).toString() },
      cert, key, rejectUnauthorized: false, timeout: 120000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, dataLength: data.length }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function testPageSize(pageSize) {
  const payload = {
    grants: { trainingPartner: { uen: UEN, code: PARTNER_CODE } },
    parameters: { page: 0, pageSize }
  };
  const encrypted = encrypt(payload);
  const start = Date.now();
  try {
    const res = await makeRequest(encrypted);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  pageSize ${String(pageSize).padStart(3)}: ${elapsed}s | status ${res.status} | response ${(res.dataLength / 1024).toFixed(0)}KB`);
    return { pageSize, elapsed: parseFloat(elapsed), ok: true };
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  pageSize ${String(pageSize).padStart(3)}: ${elapsed}s | FAILED: ${e.message}`);
    return { pageSize, elapsed: parseFloat(elapsed), ok: false };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== SSG Grant Search Benchmark ===\n');
  const sizes = [5, 10, 20, 50, 100];
  const results = [];

  for (const size of sizes) {
    const result = await testPageSize(size);
    results.push(result);
    await sleep(5000); // 5s between tests to be nice to SSG
  }

  // Calculate optimal
  console.log('\n--- Analysis ---');
  const totalRecords = 31844;
  const delayPerCall = 10; // seconds

  for (const r of results) {
    if (!r.ok) { console.log(`  pageSize ${r.pageSize}: FAILED — skip`); continue; }
    const pages = Math.ceil(totalRecords / r.pageSize);
    const totalTime = pages * (r.elapsed + delayPerCall);
    const minutes = (totalTime / 60).toFixed(0);
    console.log(`  pageSize ${String(r.pageSize).padStart(3)}: ${r.elapsed}s/call × ${pages} pages = ~${minutes} min total (with ${delayPerCall}s delay)`);
  }
}

main().catch(console.error);
