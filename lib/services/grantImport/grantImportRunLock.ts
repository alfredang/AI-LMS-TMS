import pool from '@/lib/db';

/**
 * One Bulk Grant Payment Sync run at a time — an upload (Step 1) or an apply (Step 3).
 *
 * Two people (or two laptops) running it together compete for the same QuickBooks invoices
 * and the small DB pool, and the second upload could stall or fail. While a run is in progress,
 * anyone else gets a clear "already running — started by X at T" refusal instead.
 *
 * Held in process memory: each tenant runs a single app container, so this covers every user
 * of that tenant. The holder heartbeats while its work is alive; a lock with no heartbeat for
 * STALE_MS (process crashed / restarted mid-run) is treated as free, so it can never stick.
 */

export type GrantImportRunKind = 'upload' | 'apply';

export type GrantImportRunHolder = {
  token: string;
  kind: GrantImportRunKind;
  actorUserId: string;
  actorName: string;
  startedAt: string;
  heartbeatAt: string;
  detail?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __grantImportRunLock: GrantImportRunHolder | null | undefined;
}

const STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

function currentHolder(): GrantImportRunHolder | null {
  const h = globalThis.__grantImportRunLock ?? null;
  if (h && Date.now() - Date.parse(h.heartbeatAt) > STALE_MS) {
    globalThis.__grantImportRunLock = null;
    return null;
  }
  return h;
}

async function actorDisplayName(actorUserId: string): Promise<string> {
  try {
    const r = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), email) AS name FROM public.app_user WHERE id::text = $1 LIMIT 1`,
      [actorUserId]
    );
    return String(r.rows[0]?.name || 'another user');
  } catch {
    return 'another user';
  }
}

export function grantImportBusyMessage(h: GrantImportRunHolder): string {
  const at = new Date(h.startedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
  const what = h.kind === 'upload' ? 'processing an upload' : 'applying payments to QuickBooks';
  return `Bulk Grant Payment Sync is already in use — ${h.actorName} is ${what} (started ${at}). Please wait until it finishes, then try again.`;
}

export async function acquireGrantImportRunLock(
  kind: GrantImportRunKind,
  actorUserId: string,
  detail?: string
): Promise<{ ok: true; token: string } | { ok: false; holder: GrantImportRunHolder; message: string }> {
  const actorName = await actorDisplayName(actorUserId);
  // Check-and-set with no await in between, so two requests can't both take it.
  const held = currentHolder();
  if (held) return { ok: false, holder: held, message: grantImportBusyMessage(held) };
  const now = new Date().toISOString();
  const token = `${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  globalThis.__grantImportRunLock = { token, kind, actorUserId, actorName, startedAt: now, heartbeatAt: now, detail };
  return { ok: true, token };
}

export function releaseGrantImportRunLock(token: string | null | undefined): void {
  if (token && globalThis.__grantImportRunLock?.token === token) globalThis.__grantImportRunLock = null;
}

/** Keeps the lock alive while `work` runs, and always releases it afterwards. */
export async function withGrantImportRunLock<T>(token: string, work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    const h = globalThis.__grantImportRunLock;
    if (h?.token === token) h.heartbeatAt = new Date().toISOString();
  }, HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    releaseGrantImportRunLock(token);
  }
}
