/**
 * Test script for POST /api/external/assign-trainer
 *
 * Usage:
 *   node scripts/test-assign-trainer.js
 *
 * Override any value via env:
 *   API_URL=http://localhost:3000 COURSE_RUN_ID=1303232 TRAINER_EMAIL=trainer@example.com node scripts/test-assign-trainer.js
 */

const fs   = require('fs');
const path = require('path');

// Load .env.local automatically
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach(line => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length && !key.startsWith('#')) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    });
}

const BASE_URL        = process.env.API_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const API_KEY         = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT || '';
const COURSE_RUN_ID   = process.env.COURSE_RUN_ID  || '1226243';
const TRAINER_EMAIL   = process.env.TRAINER_EMAIL  || 'angchewhoe@gmail.com';
// Fallback fields — only sent if webhook is down
const COURSE_CODE     = process.env.COURSE_CODE    || '';
const START_DATE      = process.env.START_DATE     || '';  // e.g. "12 Mar 2026" or "20260312"
const END_DATE        = process.env.END_DATE       || '';
const MODE            = process.env.MODE           || '';  // defaults to "Physical" on server
const QR_CODE_LINK    = process.env.QR_CODE_LINK   || '';  // e.g. ".../take-attendance/RA741642"
const COURSE_TITLE    = process.env.COURSE_TITLE   || '';

if (!API_KEY) {
  console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT not found in .env.local');
  process.exit(1);
}

async function testAssignTrainer() {
  const url  = `${BASE_URL}/api/external/assign-trainer`;
  const body = {
    course_run_id: COURSE_RUN_ID,
    trainer_email: TRAINER_EMAIL,
    // Fallback fields — only used if n8n webhook is unavailable
    ...(COURSE_CODE  && { course_code:      COURSE_CODE }),
    ...(START_DATE   && { start_date:       START_DATE }),
    ...(END_DATE     && { end_date:         END_DATE }),
    ...(MODE         && { mode_of_training: MODE }),
    ...(QR_CODE_LINK && { qr_code_link:     QR_CODE_LINK }),
    ...(COURSE_TITLE && { course_title:     COURSE_TITLE }),
  };

  console.log('─'.repeat(60));
  console.log('POST', url);
  console.log('Body:', body);
  console.log('─'.repeat(60));

  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  console.log(`Status: ${res.status}`);
  console.log('Response:', JSON.stringify(json, null, 2));
  console.log(res.ok ? '\n✅ Success!' : '\n❌ Failed');
}

(async () => {
  try {
    await testAssignTrainer();
  } catch (err) {
    console.error('Error running tests:', err.message);
  }
})();
