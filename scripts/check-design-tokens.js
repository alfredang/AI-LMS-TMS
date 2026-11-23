#!/usr/bin/env node
/**
 * Guardrail: pages and components take their colours from the shared design system
 * (tokens + component classes in styles/globals.css, mapped in tailwind.config.js) —
 * not from raw grey/white/black/hex classes, which drift and break the light/dark themes.
 *
 * Raw colour classes still in the code are recorded per file in
 * scripts/design-tokens-baseline.json. This check fails when a file gains raw colour
 * classes or a new file uses any, so the count can only go down.
 *
 * Run:     node scripts/check-design-tokens.js            (exits 1 on new raw colours)
 * Update:  node scripts/check-design-tokens.js --update   (after migrating files: lowers the baseline)
 * Wired into `npm run lint` and `npm run build`.
 *
 * Use instead:  text-on-surface / text-on-surface-secondary / text-muted, bg-surface /
 * bg-surface-elevated / bg-background, border-default / border-strong, text-primary,
 * status colours (text-success, bg-danger-bg …) and the classes .card .btn-* .input .table
 * .tabs/.tab .chip-* .pill-* .nav-item. A deliberate exception (a document preview that is
 * always white paper, a QR code background) can carry `// design-tokens-allow` on its line.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['components', 'layouts', 'pages'];
const BASELINE = path.join(__dirname, 'design-tokens-baseline.json');

// Raw colours: neutral palette shades, plain white/black surfaces/text, arbitrary hex.
// (text-white on a coloured fill is fine — it is the on-primary colour.)
const RAW = /(?:^|[\s"'`{])(?:[a-z-]+:)*(?:(?:text|bg|border|divide|placeholder|ring|from|to|via)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}|(?:bg|border|divide|from|to|via)-(?:white|black)|text-black)(?:\/\d+)?(?=[\s"'`}]|$)|\b(?:text|bg|border)-\[#[0-9a-fA-F]{3,8}\]/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p.endsWith(path.join('pages', 'api'))) continue;
      walk(p, out);
    } else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function count(file) {
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.includes('design-tokens-allow')) continue;
    const m = line.match(RAW);
    if (m) n += m.length;
  }
  return n;
}

const files = DIRS.flatMap(d => walk(path.join(ROOT, d), []));
const current = {};
for (const f of files) {
  const n = count(f);
  if (n) current[path.relative(ROOT, f)] = n;
}

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`✓ design-token baseline updated: ${total} raw colour classes in ${Object.keys(current).length} files`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const worse = Object.entries(current).filter(([f, n]) => n > (baseline[f] || 0));
if (worse.length) {
  console.error('✗ New raw colour classes — use the design-system tokens/classes instead (see styles/globals.css):');
  for (const [f, n] of worse) console.error(`  ${f}: ${n} (baseline ${baseline[f] || 0})`);
  console.error('  Run with --update only after the file is migrated (the baseline may only go down).');
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`✓ Design tokens OK (${total} raw colour classes left, baseline ${base})`);
