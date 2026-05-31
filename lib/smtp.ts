import nodemailer, { Transporter } from 'nodemailer';
import pool from './db';

// SMTP credentials live in the training_provider row (single-tenant per
// deployment) alongside the other integrations (R2, n8n, Magento, OpenClaw).
// Schema columns (added on demand by training-provider/update.ts):
//   smtp_enabled (boolean, default false), smtp_host, smtp_port,
//   smtp_secure ('tls'|'ssl'), smtp_auth, smtp_user, smtp_password, smtp_from
//
// Default behavior is unchanged: smtp_enabled = false ⇒ Gmail OAuth path runs.
// Only when an admin flips the toggle in Company Settings → Integration → SMTP
// AND fills host/user/password does isSmtpEnabled() return true.

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: 'tls' | 'ssl';
  auth: 'login' | 'plain';
  user: string;
  password: string;
  from: string;
}

interface CachedConfig {
  config: SmtpConfig | null;
  expiresAt: number;
}

let cached: CachedConfig | null = null;
const CACHE_TTL_MS = 60_000;

async function loadConfig(): Promise<SmtpConfig | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  let row: any = null;
  try {
    const r = await pool.query(
      `SELECT smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_auth,
              smtp_user, smtp_password, smtp_from
         FROM training_provider
        ORDER BY created_at ASC NULLS LAST
        LIMIT 1`,
    );
    row = r.rows[0] || null;
  } catch {
    // Columns don't exist yet — treat as disabled. The Gmail OAuth path stays
    // the default and nothing in the existing flow needs to change.
    row = null;
  }

  // Legacy env-var fallback retained ONLY for the Coolify cutover window.
  // REMOVE after SMTP_* env vars are deleted from Coolify.
  const envHost = process.env.SMTP_HOST || '';
  const envUser = process.env.SMTP_USER || '';
  const envPass = process.env.SMTP_PASS || '';

  const dbHost = row?.smtp_host || '';
  const dbUser = row?.smtp_user || '';
  const dbPass = row?.smtp_password || '';

  const host = dbHost || envHost;
  const user = dbUser || envUser;
  const password = dbPass || envPass;

  // Port: DB wins, then env, then sensible default per secure mode.
  const secureRaw = (row?.smtp_secure || '').toLowerCase();
  const secure: 'tls' | 'ssl' = secureRaw === 'ssl' ? 'ssl' : 'tls';
  const rawPort = row?.smtp_port ?? process.env.SMTP_PORT;
  const parsedPort = rawPort ? parseInt(String(rawPort), 10) : NaN;
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : (secure === 'ssl' ? 465 : 587);

  const auth: 'login' | 'plain' = (row?.smtp_auth || '').toLowerCase() === 'plain' ? 'plain' : 'login';

  const from = row?.smtp_from || process.env.SMTP_FROM || user;

  // The master toggle: DB-driven. If the DB row has no smtp_enabled, treat as
  // disabled — current Gmail OAuth path continues to run, untouched.
  const enabled = row?.smtp_enabled === true;

  const config: SmtpConfig = { enabled, host, port, secure, auth, user, password, from };
  cached = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  return loadConfig();
}

// True only when the toggle is on AND we have host + user + password.
// Anywhere this returns false, the caller must fall back to the existing
// Gmail OAuth code path.
export async function isSmtpEnabled(): Promise<boolean> {
  const c = await loadConfig();
  if (!c) return false;
  if (!c.enabled) return false;
  return !!(c.host && c.user && c.password);
}

export function invalidateSmtpConfigCache(): void {
  cached = null;
}

function buildTransporter(c: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure === 'ssl', // true for 465 (implicit TLS), false for 587 (STARTTLS)
    auth: {
      user: c.user,
      pass: c.password,
    },
    authMethod: c.auth === 'plain' ? 'PLAIN' : 'LOGIN',
  });
}

export interface SmtpSendOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string; // overrides config.from
  replyTo?: string;
}

export interface SmtpSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

// Send via SMTP using the current DB config. Does NOT check the toggle —
// the caller decides whether to route here. Used by both the runtime guard
// (when toggle is on) and the "Send Test" button (which tests config
// regardless of toggle so an admin can verify before flipping it on).
export async function sendViaSmtp(options: SmtpSendOptions, overrideConfig?: SmtpConfig): Promise<SmtpSendResult> {
  const c = overrideConfig || (await loadConfig());
  if (!c || !c.host || !c.user || !c.password) {
    return { ok: false, error: 'SMTP is not configured. Fill host, username and password under Company Settings → Integration → SMTP.' };
  }
  try {
    const transporter = buildTransporter(c);
    const info = await transporter.sendMail({
      from: options.from || c.from || c.user,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
