// Generate a staff distribution from an explicit code-only allowlist.
// This does not enable the server endpoints or deploy the website.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Zip = require('pizzip');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'extensions/tia-renewal-sync');
const local = process.argv.includes('--local');
const output = path.join(root, 'public/downloads/tpg-renewal', ...(local ? ['local'] : []));
const origin = local ? 'http://localhost:3000' : 'https://lms-tms.tertiaryinfotech.com';
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const version = manifest.version;
const archiveName = `tia-tpg-renewal-sync-${local ? 'local' : 'staff'}-v${version}.zip`;
const zip = new Zip();

manifest.name = local ? 'TIA TPG Renewal Sync (Local Trial)' : 'TIA TPG Renewal Sync';
manifest.description = 'Captures TPG applications for a reviewed TIA course renewal update.';
manifest.action.default_title = 'TIA TPG Renewal Sync';
manifest.host_permissions = ['https://www.tpgateway.gov.sg/*', `${origin}/*`];
manifest.content_scripts = manifest.content_scripts.map(entry => ({
  ...entry, matches: entry.matches.map(match => match.replace('http://localhost:3000', origin)),
}));
zip.file('extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['background.js', 'tia-bridge.js', 'tpg-reader.js']) {
  let content = fs.readFileSync(path.join(source, name), 'utf8');
  if (name !== 'tpg-reader.js' && !content.includes('http://localhost:3000')) {
    throw new Error(`${name}: origin replacement needs review`);
  }
  content = content.replaceAll('http://localhost:3000', origin)
    .replaceAll('Only the TIA localhost page can start a capture.', 'Only the TIA website can start a capture.');
  if (!local && content.includes('localhost:3000')) throw new Error(`${name}: unexpected localhost reference`);
  zip.file(`extension/${name}`, content);
}
const guide = fs.readFileSync(path.join(root, `docs/tpg-renewal-${local ? 'local' : 'staff'}-guide.md`), 'utf8');
if (!guide.includes(`Release: ${version}`)) throw new Error('Update the guide version before packaging.');
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const guideHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TPG renewal staff guide</title><style>body{max-width:850px;margin:32px auto;padding:0 20px;color:#182230;background:#fff;font:16px/1.6 system-ui}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style><main><pre>${escapeHtml(guide)}</pre></main></html>`;
zip.file('START-HERE.html', guideHtml);
zip.file('README.txt', guide);
fs.mkdirSync(output, { recursive: true });
const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(path.join(output, archiveName), bytes);
fs.writeFileSync(path.join(output, 'setup-guide.html'), guideHtml);
const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({
  version, origin, status: local ? 'local-trial' : 'staff-release', file: archiveName,
  bytes: bytes.length, sha256: checksum,
}, null, 2) + '\n');
console.log(JSON.stringify({ file: path.join(output, archiveName), bytes: bytes.length, sha256: checksum, entries: Object.keys(zip.files) }, null, 2));
