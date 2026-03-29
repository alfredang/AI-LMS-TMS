/**
 * Populate ssg_enrolments from SSG API, then sync to main enrollment table.
 * Combines populate-enrolments.js + sync-enrolments.js in one run.
 *
 * Usage:
 *   node scripts/populate-and-sync-enrolments.js
 *   RESUME_PAGE=5 node scripts/populate-and-sync-enrolments.js
 *
 * Requires: .env.local with DATABASE_URL, CERT_1_CERT, CERT_1_KEY, CERT_1_ENCRYPTION_KEY
 */

const { execSync } = require('child_process');

try {
  const resumeEnv = process.env.RESUME_PAGE ? `RESUME_PAGE=${process.env.RESUME_PAGE} ` : '';
  console.log('>>> Step 1: Populate ssg_enrolments from SSG API\n');
  execSync(`${resumeEnv}node scripts/populate-enrolments.js`, { stdio: 'inherit', cwd: __dirname + '/..' });

  console.log('\n\n>>> Step 2: Sync ssg_enrolments → enrollment\n');
  execSync('node scripts/sync-enrolments.js', { stdio: 'inherit', cwd: __dirname + '/..' });
} catch (err) {
  console.error('Script failed:', err.message);
  process.exit(1);
}
