const { Pool } = require('pg');
const https = require('https');

const DATABASE_URL = process.env.DATABASE_URL;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1lLphFYcwV_h2gyYeviO4kbF0yb4AfMZ4TKzy9DqW3b8/export?format=csv&gid=298101537';

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    get(url);
  });
}

function parseCSV(text) {
  const lines = [];
  let current = '', inQuotes = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(current.trim()); current = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current.trim()); current = ''; lines.push(row); row = [];
        if (ch === '\r') i++;
      } else { current += ch; }
    }
  }
  if (current || row.length) { row.push(current.trim()); lines.push(row); }
  return lines;
}

(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  // 1. Fetch CSV
  console.log('Fetching Google Sheet...');
  const csv = await fetchCSV(SHEET_URL);
  const rows = parseCSV(csv);
  const header = rows[0];
  const emailIdx = header.findIndex(h => h.toLowerCase() === 'email');
  const cvIdx = header.findIndex(h => h.toLowerCase() === 'cv');
  console.log(`Columns: Email=${emailIdx}, CV=${cvIdx}`);

  // 2. Build email->cvUrl map, splitting semicolons
  const emailToCv = {};
  let sheetRowsWithCv = 0;
  for (let i = 1; i < rows.length; i++) {
    const emailCell = (rows[i][emailIdx] || '').trim();
    const cvUrl = (rows[i][cvIdx] || '').trim();
    if (!emailCell || !cvUrl) continue;
    sheetRowsWithCv++;
    // Split by semicolons, commas, or spaces to handle multiple emails
    const emails = emailCell.split(/[;,\s]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
    for (const em of emails) {
      emailToCv[em] = cvUrl;
    }
  }
  console.log(`Sheet: ${sheetRowsWithCv} rows with CV URLs, ${Object.keys(emailToCv).length} individual emails mapped`);

  // 3. Get trainers without cv_folder_url
  const trainers = await pool.query(`
    SELECT tp.user_id, au.email, au.full_name
    FROM trainer_profile tp
    JOIN app_user au ON tp.user_id = au.id
    WHERE tp.cv_folder_url IS NULL
  `);
  console.log(`Trainers without cv_folder_url: ${trainers.rows.length}`);

  // 4. Match and update
  let updated = 0, notFound = 0;
  for (const t of trainers.rows) {
    const email = (t.email || '').trim().toLowerCase();
    const cvUrl = emailToCv[email];
    if (cvUrl) {
      await pool.query('UPDATE trainer_profile SET cv_folder_url = $1 WHERE user_id = $2', [cvUrl, t.user_id]);
      console.log(`  ✅ ${t.full_name} (${t.email}) -> ${cvUrl.substring(0, 60)}...`);
      updated++;
    } else {
      notFound++;
    }
  }

  // 5. Also check developer_profile
  const devs = await pool.query(`
    SELECT dp.user_id, au.email, au.full_name
    FROM developer_profile dp
    JOIN app_user au ON dp.user_id = au.id
    WHERE dp.cv_folder_url IS NULL
  `);
  let devUpdated = 0;
  for (const d of devs.rows) {
    const email = (d.email || '').trim().toLowerCase();
    const cvUrl = emailToCv[email];
    if (cvUrl) {
      await pool.query('UPDATE developer_profile SET cv_folder_url = $1 WHERE user_id = $2', [cvUrl, d.user_id]);
      console.log(`  ✅ [Dev] ${d.full_name} (${d.email}) -> ${cvUrl.substring(0, 60)}...`);
      devUpdated++;
    }
  }

  console.log(`\nDone! Trainers: ${updated} updated, ${notFound} not in sheet. Developers: ${devUpdated} updated.`);
  await pool.end();
})();
