// The uploads volume also holds files the server needs but the web must never serve: signing
// keys and certificates, the Google service-account key, and whatever the host keeps at the
// volume root. Only learner/trainer documents and images (and the company logo and document
// templates) are web assets. next.config.js sends every /uploads/* request through the API route (beforeFiles), so the static
// file server cannot bypass this check; every route that reads from the uploads volume calls it.
const PUBLIC_TRAINING_PROVIDER_FOLDERS = new Set([
  'company_logo', 'logo', 'certificate_template', 'invoice_template', 'receipt_template', 'pro_forma_invoice_template', 'misc',
]);
const BLOCKED_EXTENSIONS = new Set([
  '.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore', '.json', '.env', '.yaml', '.yml', '.sh', '.php', '.phtml',
]);

export function isServableUpload(segments: string[]): boolean {
  const parts = segments.map(s => String(s || '')).filter(Boolean);
  // Nothing at the volume root, no dotfiles or parent hops anywhere in the path
  if (parts.length < 2) return false;
  if (parts.some(s => s.startsWith('.') || s.includes('\\') || s.includes('\0'))) return false;
  if (parts[0].toLowerCase() === 'training_provider' && !PUBLIC_TRAINING_PROVIDER_FOLDERS.has(parts[1].toLowerCase())) return false;
  const name = parts[parts.length - 1].toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return !BLOCKED_EXTENSIONS.has(ext);
}


/**
 * The same check for a path relative to `public/` (e.g. `uploads/announcements/x.pdf`). Paths
 * outside the uploads volume are build-time assets: allowed unless they are dotfiles.
 */
export function isServablePublicPath(relativePath: string): boolean {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(s => s === '..' || s.startsWith('.'))) return false;
  if ((parts[0] || '').toLowerCase() !== 'uploads') return true;
  return isServableUpload(parts.slice(1));
}
