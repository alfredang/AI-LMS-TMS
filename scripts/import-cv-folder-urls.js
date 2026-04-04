const { Pool } = require('pg');
const https = require('https');
const http = require('http');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const follow = (u, depth) => {
      if (depth > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, depth + 1);
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    follow(url, 0);
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => (obj[h.trim()] = (vals[i] || '').trim()));
      return obj;
    });
}

(async () => {
  try {
    const csv = await fetchCSV(
      'https://docs.google.com/spreadsheets/d/1lLphFYcwV_h2gyYeviO4kbF0yb4AfMZ4TKzy9DqW3b8/export?format=csv&gid=298101537'
    );
    const rows = parseCSV(csv);
    console.log('Total rows from sheet:', rows.length);

    const withCV = rows.filter((r) => r.Email && r.CV && r.CV.startsWith('http'));
    console.log('Rows with CV folder URL:', withCV.length);

    let updated = 0;
    let notFound = 0;
    const notFoundList = [];

    for (const row of withCV) {
      const email = row.Email.toLowerCase().trim();
      const cvUrl = row.CV.trim();

      // Match by email in app_user -> get user_id -> update trainer_profile
      const userResult = await pool.query(
        `SELECT au.id FROM app_user au 
         JOIN user_role_map urm ON au.id = urm.user_id 
         WHERE LOWER(au.email) = $1 AND urm.role::text = 'Trainer' 
         LIMIT 1`,
        [email]
      );

      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;
        await pool.query('UPDATE trainer_profile SET cv_folder_url = $1 WHERE user_id = $2', [cvUrl, userId]);
        updated++;
      } else {
        notFound++;
        notFoundList.push(row['Common Name'] + ' <' + email + '>');
      }
    }

    console.log('Updated:', updated, '| Not found in DB:', notFound);
    if (notFoundList.length > 0 && notFoundList.length <= 20) {
      console.log('Not found trainers:', notFoundList.join(', '));
    }

    // Show sample
    const sample = await pool.query(
      `SELECT tp.user_id, au.name, au.email, tp.cv_folder_url 
       FROM trainer_profile tp 
       JOIN app_user au ON tp.user_id = au.id 
       WHERE tp.cv_folder_url IS NOT NULL 
       LIMIT 10`
    );
    console.log('\nSample updated trainers:');
    sample.rows.forEach((r) =>
      console.log('  ', r.name, '-', r.email, '->', r.cv_folder_url.substring(0, 60) + '...')
    );

    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    await pool.end();
    process.exit(1);
  }
})();
