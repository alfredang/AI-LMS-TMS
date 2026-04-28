// Imports CV/Documents folder URLs from the legacy TMS Google Sheet
// into trainer_profile.cv_folder_url (and developer_profile.cv_folder_url).
//
// Matches each sheet row to a trainer by EMAIL first (any address in the
// Email cell), then falls back to NAME (Full Name or Common Name) when
// no email match is found.
//
// Usage:
//   node scripts/import-cv-folder-urls-v3.js          # dry-run (no writes)
//   node scripts/import-cv-folder-urls-v3.js --apply  # actually update DB

const { Pool } = require('pg');
const https = require('https');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1lLphFYcwV_h2gyYeviO4kbF0yb4AfMZ4TKzy9DqW3b8/export?format=csv&gid=298101537';

const APPLY = process.argv.includes('--apply');

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return get(res.headers.location);
          }
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    };
    get(url);
  });
}

function parseCSV(text) {
  const rows = [];
  let current = '',
    inQuotes = false,
    row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current.trim());
        rows.push(row);
        current = '';
        row = [];
        if (ch === '\r') i++;
      } else current += ch;
    }
  }
  if (current || row.length) {
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

const normName = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitEmails = (cell) =>
  (cell || '')
    .split(/[;,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
      ? { rejectUnauthorized: false }
      : false,
  });

  console.log(APPLY ? '🔧 APPLY MODE — will update DB' : '🔍 DRY-RUN — no DB writes');
  console.log('Fetching sheet...');
  const csv = await fetchCSV(SHEET_URL);
  const rows = parseCSV(csv);
  const header = rows[0].map((h) => h.toLowerCase());
  const emailIdx = header.indexOf('email');
  const cvIdx = header.indexOf('cv');
  const fullNameIdx = header.indexOf('full name');
  const commonNameIdx = header.indexOf('common name');
  console.log(
    `Columns -> email:${emailIdx} cv:${cvIdx} full_name:${fullNameIdx} common_name:${commonNameIdx}`,
  );

  // Build lookup maps from sheet
  const emailToCv = new Map();
  const nameToCv = new Map();
  let sheetRowsWithCv = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const cv = (r[cvIdx] || '').trim();
    if (!cv || !cv.includes('drive.google.com')) continue;
    sheetRowsWithCv++;
    for (const e of splitEmails(r[emailIdx])) emailToCv.set(e, cv);
    for (const nameRaw of [r[fullNameIdx], r[commonNameIdx]]) {
      const n = normName(nameRaw);
      if (n) nameToCv.set(n, cv);
    }
  }
  console.log(
    `Sheet rows with CV link: ${sheetRowsWithCv} (emails: ${emailToCv.size}, names: ${nameToCv.size})`,
  );

  // Pull profiles needing a folder URL (NULL or empty)
  const trainers = await pool.query(`
    SELECT tp.user_id, au.email, au.full_name, tp.common_name, tp.cv_folder_url
    FROM trainer_profile tp
    JOIN app_user au ON tp.user_id = au.id
    WHERE tp.cv_folder_url IS NULL OR tp.cv_folder_url = ''
    ORDER BY au.full_name
  `);
  console.log(`\nTrainers needing cv_folder_url: ${trainers.rows.length}`);

  let byEmail = 0,
    byName = 0,
    notFound = [];
  const updates = [];
  for (const t of trainers.rows) {
    const email = (t.email || '').trim().toLowerCase();
    let cv = email ? emailToCv.get(email) : null;
    let how = 'email';
    if (!cv) {
      for (const candidate of [t.full_name, t.common_name]) {
        const n = normName(candidate);
        if (n && nameToCv.has(n)) {
          cv = nameToCv.get(n);
          how = 'name';
          break;
        }
      }
    }
    if (cv) {
      updates.push({ user_id: t.user_id, full_name: t.full_name, email: t.email, cv, how });
      if (how === 'email') byEmail++;
      else byName++;
    } else {
      notFound.push({ full_name: t.full_name, email: t.email });
    }
  }

  console.log(`\n--- Trainer matches ---`);
  console.log(`  by email: ${byEmail}`);
  console.log(`  by name:  ${byName}`);
  console.log(`  unmatched: ${notFound.length}`);

  if (updates.length) {
    console.log('\nSample matches:');
    for (const u of updates.slice(0, 8))
      console.log(`  [${u.how}] ${u.full_name} <${u.email || '-'}> -> ${u.cv.slice(0, 70)}...`);
  }
  if (notFound.length) {
    console.log('\nFirst 15 unmatched trainers:');
    for (const n of notFound.slice(0, 15)) console.log(`  - ${n.full_name} <${n.email || '-'}>`);
  }

  // Same logic for developers
  const devs = await pool.query(`
    SELECT dp.user_id, au.email, au.full_name, dp.cv_folder_url
    FROM developer_profile dp
    JOIN app_user au ON dp.user_id = au.id
    WHERE dp.cv_folder_url IS NULL OR dp.cv_folder_url = ''
  `);
  const devUpdates = [];
  for (const d of devs.rows) {
    const email = (d.email || '').trim().toLowerCase();
    let cv = email ? emailToCv.get(email) : null;
    let how = 'email';
    if (!cv) {
      const n = normName(d.full_name);
      if (n && nameToCv.has(n)) {
        cv = nameToCv.get(n);
        how = 'name';
      }
    }
    if (cv) devUpdates.push({ user_id: d.user_id, full_name: d.full_name, cv, how });
  }
  console.log(`\nDeveloper matches: ${devUpdates.length} (of ${devs.rows.length} needing URL)`);

  if (APPLY) {
    console.log('\nApplying updates...');
    for (const u of updates) {
      await pool.query(
        'UPDATE trainer_profile SET cv_folder_url = $1 WHERE user_id = $2',
        [u.cv, u.user_id],
      );
    }
    for (const u of devUpdates) {
      await pool.query(
        'UPDATE developer_profile SET cv_folder_url = $1 WHERE user_id = $2',
        [u.cv, u.user_id],
      );
    }
    console.log(`✅ Updated ${updates.length} trainers and ${devUpdates.length} developers.`);
  } else {
    console.log('\n(dry-run — re-run with --apply to write to DB)');
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
