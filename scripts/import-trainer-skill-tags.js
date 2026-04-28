// Imports skill tags + certification tags from the legacy TMS Google Sheet
// into trainer_profile.skills_tags and trainer_profile.certification_tags.
//
// skills_tags         <- Domain + Skill Sets (deduped, max 5)
// certification_tags  <- Certifications     (deduped, max 5)
//
// Match: email first, then name (full_name | common_name).
// Skip: trainers whose skills_tags is already non-empty.
//
// Usage:
//   node scripts/import-trainer-skill-tags.js          # dry-run
//   node scripts/import-trainer-skill-tags.js --apply  # write to DB

const { Pool } = require('pg');
const https = require('https');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1lLphFYcwV_h2gyYeviO4kbF0yb4AfMZ4TKzy9DqW3b8/export?format=csv&gid=298101537';
const APPLY = process.argv.includes('--apply');
const MAX_TAGS = 5;

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const get = (u) =>
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
            return get(res.headers.location);
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    get(url);
  });
}

function parseCSV(text) {
  const rows = [];
  let cur = '',
    inQ = false,
    row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') {
        row.push(cur.trim());
        cur = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(cur.trim());
        rows.push(row);
        cur = '';
        row = [];
        if (ch === '\r') i++;
      } else cur += ch;
    }
  }
  if (cur || row.length) {
    row.push(cur.trim());
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

// Split a cell like "eCommerce, Marketing" or "Microsoft / Power Platform" into clean tags.
function splitTags(cell) {
  return (cell || '')
    .split(/[,;|/]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Dedupe case-insensitively but keep the first-seen original casing.
function dedupeCI(arr) {
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
      ? { rejectUnauthorized: false }
      : false,
  });

  console.log(APPLY ? '🔧 APPLY MODE' : '🔍 DRY-RUN');
  console.log('Fetching sheet...');
  const csv = await fetchCSV(SHEET_URL);
  const rows = parseCSV(csv);
  const header = rows[0].map((h) => h.toLowerCase());
  const idx = (name) => header.indexOf(name);
  const eIdx = idx('email'),
    fnIdx = idx('full name'),
    cnIdx = idx('common name'),
    domIdx = idx('domain'),
    skillIdx = idx('skill sets'),
    certIdx = idx('certifications');

  // Build sheet -> { skills, certs } by email and by name
  const byEmail = new Map();
  const byName = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const skills = dedupeCI([
      ...splitTags(r[domIdx]),
      ...splitTags(r[skillIdx]),
    ]).slice(0, MAX_TAGS);
    const certs = dedupeCI(splitTags(r[certIdx])).slice(0, MAX_TAGS);
    if (!skills.length && !certs.length) continue;
    const payload = { skills, certs };
    for (const e of splitEmails(r[eIdx])) byEmail.set(e, payload);
    for (const n of [r[fnIdx], r[cnIdx]]) {
      const nk = normName(n);
      if (nk) byName.set(nk, payload);
    }
  }
  console.log(
    `Sheet entries with tag data: emails=${byEmail.size}, names=${byName.size}`,
  );

  // Pull trainers with empty skills_tags
  const trainers = await pool.query(`
    SELECT tp.user_id, au.email, au.full_name, tp.common_name,
           COALESCE(tp.skills_tags, '[]'::jsonb)         AS skills_tags,
           COALESCE(tp.certification_tags, '[]'::jsonb)  AS certification_tags
    FROM trainer_profile tp
    JOIN app_user au ON tp.user_id = au.id
    ORDER BY au.full_name
  `);

  let already = 0,
    matchedEmail = 0,
    matchedName = 0,
    unmatched = [];
  const updates = [];
  for (const t of trainers.rows) {
    const existingSkills = Array.isArray(t.skills_tags) ? t.skills_tags : [];
    if (existingSkills.length > 0) {
      already++;
      continue;
    }
    const email = (t.email || '').trim().toLowerCase();
    let payload = email ? byEmail.get(email) : null;
    let how = 'email';
    if (!payload) {
      for (const cand of [t.full_name, t.common_name]) {
        const nk = normName(cand);
        if (nk && byName.has(nk)) {
          payload = byName.get(nk);
          how = 'name';
          break;
        }
      }
    }
    if (!payload) {
      unmatched.push({ full_name: t.full_name, email: t.email });
      continue;
    }
    if (how === 'email') matchedEmail++;
    else matchedName++;

    const existingCerts = Array.isArray(t.certification_tags) ? t.certification_tags : [];
    const newCerts = existingCerts.length === 0 ? payload.certs : existingCerts;

    updates.push({
      user_id: t.user_id,
      full_name: t.full_name,
      email: t.email,
      how,
      skills: payload.skills,
      certs_will_write: existingCerts.length === 0 ? payload.certs : null,
    });
  }

  console.log(`\nTrainers: ${trainers.rows.length} total`);
  console.log(`  already have skills_tags (skipped): ${already}`);
  console.log(`  matched by email: ${matchedEmail}`);
  console.log(`  matched by name:  ${matchedName}`);
  console.log(`  unmatched (no sheet entry): ${unmatched.length}`);

  console.log(`\nFirst 10 planned updates:`);
  for (const u of updates.slice(0, 10)) {
    const certsStr = u.certs_will_write ? ` certs=[${u.certs_will_write.join(', ')}]` : '';
    console.log(
      `  [${u.how}] ${u.full_name} <${u.email || '-'}> -> skills=[${u.skills.join(', ')}]${certsStr}`,
    );
  }
  if (unmatched.length) {
    console.log(`\nFirst 10 unmatched trainers:`);
    for (const u of unmatched.slice(0, 10)) console.log(`  - ${u.full_name} <${u.email || '-'}>`);
  }

  if (APPLY) {
    console.log(`\nApplying ${updates.length} updates...`);
    for (const u of updates) {
      if (u.certs_will_write) {
        await pool.query(
          'UPDATE trainer_profile SET skills_tags = $1::jsonb, certification_tags = $2::jsonb WHERE user_id = $3',
          [JSON.stringify(u.skills), JSON.stringify(u.certs_will_write), u.user_id],
        );
      } else {
        await pool.query(
          'UPDATE trainer_profile SET skills_tags = $1::jsonb WHERE user_id = $2',
          [JSON.stringify(u.skills), u.user_id],
        );
      }
    }
    console.log(`✅ Updated ${updates.length} trainers.`);
  } else {
    console.log('\n(dry-run — re-run with --apply to write to DB)');
  }

  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
