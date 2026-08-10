#!/usr/bin/env node
/**
 * Guardrail: every pages/api route must either be on the explicit PUBLIC
 * allowlist below or reference an auth mechanism (withAuth / withServiceAuth /
 * requireRole / getAuthedUser / an x-api-key check / its own URL-token lookup).
 *
 * Run: node scripts/check-api-auth.js   (exits 1 on violations)
 * Wired into `npm run lint` — new unauthenticated routes fail the build.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'pages', 'api');

// Routes that are public BY DESIGN. Adding to this list is a security
// decision — justify it in the PR.
const PUBLIC = new Set([
  'health.ts', // liveness probe (no data)
  'app-version.ts',
  'favicon.png.ts',
  'auth/login.ts',
  'auth/send-otp.ts',
  'auth/forgot-password.ts',
  'auth/verify.ts', // validates the presented token itself
  'auth/logout.ts', // revokes the presented token itself
  'auth/oauth-sync.ts', // service-key gated inside the handler
  'training-provider/info.ts', // login-page branding
  'training-provider/ssg-default-app.ts', // login-page config
  'training-provider/send-feedback.ts', // feedback widget on login screen
  'quickbooks/oauth/callback.ts', // OAuth redirect target (Intuit)
  'integrations/zoom/oauth/callback.ts', // OAuth redirect target (Zoom)
  'integrations/google/oauth-callback.ts', // OAuth redirect target (Google); single-use state nonce
  'files/download.ts', // <a>/<img> asset serving; containment-checked
  'uploads/[...path].ts', // <img> asset serving; containment-checked
  'download/[...path].ts', // <a>/<img> asset serving; containment-checked
  'webhooks/[token].ts', // authenticates via unguessable endpoint_token
  'feedback-form/submit.ts', // public /feedback/[runId] page
  'feedback-form/template.ts', // public /feedback/[runId] page
]);
const PUBLIC_PREFIXES = ['public/'];

const AUTH_MARKERS = /\b(withAuth|withServiceAuth|requireRole|getAuthedUser|isServiceRequest)\b|x-api-key/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const violations = [];
for (const file of walk(API).sort()) {
  const rel = path.relative(API, file).replace(/\\/g, '/');
  if (PUBLIC.has(rel) || PUBLIC_PREFIXES.some((p) => rel.startsWith(p))) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (/export \{ default \}/.test(src)) continue; // re-export; target is checked
  if (!AUTH_MARKERS.test(src)) violations.push(rel);
}

if (violations.length) {
  console.error(`\n✗ ${violations.length} API route(s) have no authentication and are not on the public allowlist:\n`);
  violations.forEach((v) => console.error('  pages/api/' + v));
  console.error('\nWrap with withAuth()/withServiceAuth() from @lib/auth/withAuth, or add to the allowlist in scripts/check-api-auth.js with a justification.\n');
  process.exit(1);
}
console.log(`✓ API auth coverage OK (${walk(API).length} route files checked)`);
