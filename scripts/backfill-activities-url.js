#!/usr/bin/env node
/**
 * Backfill course.activities_url from the Activities subfolder inside each
 * course's Courseware Link folder on Google Drive.
 *
 * The Activities/Lab URL on the course editor is a link to the course's
 * hands-on lab folder, which by house convention lives as a subfolder of the
 * courseware folder. Courses onboarded before that convention have the
 * courseware folder set but the Activities field empty, so this walks each
 * courseware folder and fills the gap.
 *
 * Only ever fills a BLANK activities_url -- a course that already has one was
 * set deliberately (some point at a folder outside the courseware folder) and
 * is never overwritten.
 *
 * Usage:
 *   node scripts/backfill-activities-url.js            # dry run, writes nothing
 *   node scripts/backfill-activities-url.js --apply    # perform the updates
 *   node scripts/backfill-activities-url.js --limit 20 # only the first N courses
 *
 * Requires DATABASE_URL in .env.local and working Google Drive OAuth
 * credentials in training_provider (Company Settings -> Google Integration).
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { google } = require('googleapis');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : null;

// Folder names that count as the activities/lab folder, best match first.
// Real courseware folders use a mix of these spellings.
const EXACT_NAMES = ['activities', 'activity', 'labs', 'lab', 'activities and labs', 'activities & labs'];
const FUZZY_TERMS = ['activit', 'lab', 'exercise', 'hands-on', 'handson', 'practical', 'workshop'];

// Terms that must never be treated as the activities folder even if a fuzzy
// term appears -- assessment and answer-key material is trainer-only.
const BLOCKED_TERMS = ['answer', 'assessment', 'marking', 'archive', 'old', 'solution', 'key'];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
  max: 3,
});

function extractFolderId(url) {
  if (!url) return null;
  const raw = String(url).trim();
  let m = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null; // a /d/ file link is NOT a folder -- deliberately unhandled
}

async function getDrive() {
  const r = await pool.query(
    `SELECT google_client_id AS "clientId",
            google_client_secret AS "clientSecret",
            google_refresh_token AS "refreshToken"
     FROM training_provider LIMIT 1`
  );
  const c = r.rows[0];
  if (!c || !c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error('Google OAuth credentials are not configured in Company Settings.');
  }
  const oauth = new google.auth.OAuth2(
    c.clientId, c.clientSecret, 'https://developers.google.com/oauthplayground'
  );
  oauth.setCredentials({ refresh_token: c.refreshToken });
  return google.drive({ version: 'v3', auth: oauth });
}

/** Pick the activities subfolder from a folder listing, or null. */
function pickActivitiesFolder(folders) {
  const usable = folders.filter(f => {
    const n = (f.name || '').trim().toLowerCase();
    return n && !BLOCKED_TERMS.some(b => n.includes(b));
  });

  for (const want of EXACT_NAMES) {
    const hit = usable.find(f => f.name.trim().toLowerCase() === want);
    if (hit) return { folder: hit, match: 'exact' };
  }
  const fuzzy = usable.filter(f =>
    FUZZY_TERMS.some(t => f.name.trim().toLowerCase().includes(t))
  );
  // Only accept a fuzzy hit when it is unambiguous.
  if (fuzzy.length === 1) return { folder: fuzzy[0], match: 'fuzzy' };
  if (fuzzy.length > 1) return { folder: null, match: 'ambiguous', candidates: fuzzy.map(f => f.name) };
  return { folder: null, match: 'none' };
}

async function listSubfolders(drive, parentId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'nextPageToken, files(id,name)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

(async () => {
  const drive = await getDrive();
  const who = await drive.about.get({ fields: 'user(emailAddress)' });
  console.log(`Drive authenticated as ${who.data.user.emailAddress}`);
  console.log(APPLY ? 'MODE: APPLY (will write)' : 'MODE: DRY RUN (no writes)');

  const rows = (await pool.query(
    `SELECT id, course_code, title, courseware_link
     FROM course
     WHERE coalesce(btrim(activities_url),'') = ''
       AND coalesce(btrim(courseware_link),'') <> ''
     ORDER BY course_code
     ${LIMIT ? `LIMIT ${LIMIT}` : ''}`
  )).rows;

  console.log(`${rows.length} course(s) with a Courseware Link and no Activities/Lab URL\n`);

  const stats = { filled: 0, exact: 0, fuzzy: 0, none: 0, ambiguous: 0, notFolder: 0, error: 0 };
  const report = [];

  for (const c of rows) {
    const label = `${c.course_code || c.id}`;
    const parentId = extractFolderId(c.courseware_link);
    if (!parentId) {
      stats.notFolder++;
      report.push({ code: label, status: 'courseware link is not a folder', detail: c.courseware_link });
      continue;
    }
    try {
      const subs = await listSubfolders(drive, parentId);
      const pick = pickActivitiesFolder(subs);

      if (!pick.folder) {
        stats[pick.match === 'ambiguous' ? 'ambiguous' : 'none']++;
        report.push({
          code: label,
          status: pick.match === 'ambiguous' ? 'ambiguous -- needs a human' : 'no activities folder',
          detail: pick.candidates ? pick.candidates.join(' | ') : subs.map(f => f.name).join(' | ') || '(no subfolders)',
        });
        continue;
      }

      const url = `https://drive.google.com/drive/folders/${pick.folder.id}`;
      stats[pick.match]++;
      report.push({ code: label, status: `match (${pick.match})`, detail: `${pick.folder.name} -> ${url}` });

      if (APPLY) {
        // Re-check emptiness in the UPDATE so a concurrent edit is never clobbered.
        const upd = await pool.query(
          `UPDATE course SET activities_url = $1, updated_at = now()
           WHERE id = $2 AND coalesce(btrim(activities_url),'') = ''`,
          [url, c.id]
        );
        if (upd.rowCount === 1) stats.filled++;
      }
    } catch (e) {
      stats.error++;
      report.push({ code: label, status: 'ERROR', detail: e.message.slice(0, 120) });
    }
  }

  console.log('--- Results ---');
  for (const r of report) console.log(`${r.code.padEnd(18)} ${r.status.padEnd(30)} ${r.detail}`);

  console.log('\n--- Summary ---');
  console.log(`exact matches      : ${stats.exact}`);
  console.log(`fuzzy matches      : ${stats.fuzzy}`);
  console.log(`ambiguous (skipped): ${stats.ambiguous}`);
  console.log(`no activities dir  : ${stats.none}`);
  console.log(`link not a folder  : ${stats.notFolder}`);
  console.log(`errors             : ${stats.error}`);
  console.log(APPLY ? `ROWS UPDATED       : ${stats.filled}` : 'DRY RUN -- nothing written. Re-run with --apply.');

  await pool.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
