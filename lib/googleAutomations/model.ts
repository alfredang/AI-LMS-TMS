import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Script } from 'node:vm';

export type ScriptFile = { name: string; type: 'SERVER_JS' | 'HTML' | 'JSON'; source: string };
export type Project = {
  scriptId: string; name: string; purpose: string; category: string; schedule: string;
  dependencies: string; refreshedAt: string | null; sourceHash: string | null; accessStatus: string;
};
export class AutomationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertScriptId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(id)) throw new AutomationError(400, 'Enter a valid Apps Script project ID.');
}
export function normalizeFiles(input: unknown): ScriptFile[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new AutomationError(400, 'A project must contain between 1 and 100 files.');
  const names = new Set<string>();
  const files = input.map((file: any) => {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 200 || !['SERVER_JS', 'HTML', 'JSON'].includes(file.type) || typeof file.source !== 'string') throw new AutomationError(400, 'Invalid script file.');
    const name = file.name.normalize('NFC');
    if (names.has(name)) throw new AutomationError(400, 'Duplicate script file name.');
    names.add(name);
    return { name, type: file.type, source: file.source } as ScriptFile;
  });
  if (Buffer.byteLength(JSON.stringify(files)) > 4 * 1024 * 1024) throw new AutomationError(400, 'Project source exceeds the 4 MB editor limit.');
  const manifest = files.find(f => f.name === 'appsscript' && f.type === 'JSON');
  if (!manifest) throw new AutomationError(400, 'The appsscript JSON manifest must be preserved.');
  try { JSON.parse(manifest.source); } catch { throw new AutomationError(400, 'Invalid appsscript manifest JSON.'); }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
export function sourceHash(files: ScriptFile[]): string {
  return createHash('sha256').update(JSON.stringify(normalizeFiles(files))).digest('hex');
}

// Redaction is defense in depth. All source access still requires a privileged session.
// Tokens are deterministic so drafts preserve hidden values without sending them to browsers.
export function maskSource(source: string) {
  const secrets = new Map<string, string>();
  const mask = (value: string) => {
    if (!value || /^\[TMS_SECRET_[a-f0-9]+\]$/.test(value)) return value;
    const token = `[TMS_SECRET_${createHash('sha256').update(value).digest('hex').slice(0, 24)}]`;
    secrets.set(token, value);
    return token;
  };
  let masked = source.replace(/(\b[\w$]*(?:token|secret|password|api_?key|private_?key)[\w$]*\s*[:=]\s*)(["'`])([^\r\n]*?)\2/gi,
    (_all, prefix, quote, value) => `${prefix}${quote}${mask(value)}${quote}`);
  masked = masked.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, mask);
  masked = masked.replace(/(?:GOCSPX-[\w-]+|ya29\.[\w.-]+|1\/\/[\w.-]{20,})/g, mask);
  masked = masked.replace(/([?&](?:access_token|refresh_token|api_key|key|token|secret|password)=)([^\s"'`&]+)/gi, (_all, prefix, value) => `${prefix}${mask(value)}`);
  return { source: masked, secrets };
}
export function publicFiles(files: ScriptFile[]): ScriptFile[] {
  return files.map(f => ({ ...f, source: maskSource(f.source).source }));
}
export function restoreMaskedFiles(base: ScriptFile[], input: unknown): ScriptFile[] {
  const edited = normalizeFiles(input);
  if (edited.length !== base.length) throw new AutomationError(400, 'Adding or deleting files is not supported in this phase.');
  return edited.map(file => {
    const before = base.find(f => f.name === file.name && f.type === file.type);
    if (!before) throw new AutomationError(400, 'File names and types must be preserved.');
    const redacted = maskSource(before.source);
    for (const token of redacted.secrets.keys()) {
      if (file.source.split(token).length !== redacted.source.split(token).length) throw new AutomationError(400, 'Keep every masked credential placeholder unchanged.');
    }
    let source = file.source.replace(/\[TMS_SECRET_[a-f0-9]+\]/g, token => {
      const secret = redacted.secrets.get(token);
      if (secret === undefined) throw new AutomationError(400, 'Unknown credential placeholder. Reload the current source.');
      return secret;
    });
    if (file.type === 'JSON' && source !== before.source) throw new AutomationError(400, 'Manifest changes are outside this phase.');
    return { ...file, source };
  });
}
export function seal(value: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), bytes.toString('base64')].join('.');
}
export function unseal<T>(value: string, key: string): T {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1') throw new AutomationError(500, 'Unsupported source backup format.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body, 'base64')), cipher.final()]).toString('utf8'));
}
export function changedFiles(before: ScriptFile[], after: ScriptFile[]) {
  return [...new Set([...before.map(f=>f.name),...after.map(f=>f.name)])].filter(name => before.find(f=>f.name===name)?.source !== after.find(f=>f.name===name)?.source);
}
export function validateEditableSource(before: ScriptFile[], after: ScriptFile[]) {
  if (before.length!==after.length || after.some(f=>!before.some(b=>b.name===f.name&&b.type===f.type))) throw new AutomationError(400,'File names and types must be preserved.');
  for (const file of after) {
    if (file.type==='JSON' && before.find(f=>f.name===file.name)?.source!==file.source) throw new AutomationError(400,'Manifest changes are outside this phase.');
    if (file.type==='SERVER_JS') {
      try { new Script(file.source,{filename:`${file.name}.gs`}); }
      catch { throw new AutomationError(400,`JavaScript syntax check failed in ${file.name}. Review this file before saving.`); }
    }
  }
}
export function capabilities(roles: Set<string>, isService = false) {
  return { canView: !isService && ['admin', 'developer', 'trainingProvider'].some(r => roles.has(r)), canEdit: !isService && ['admin', 'developer'].some(r => roles.has(r)), canPublish: !isService && ['admin', 'developer'].some(r => roles.has(r)) };
}
