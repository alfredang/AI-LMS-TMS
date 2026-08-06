import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../db';
import { hashSessionToken, SESSION_TOKEN_PREFIX } from './session';
import { isServiceRequest } from './serviceKey';

const LEGACY_TOKEN_PREFIX = 'mock-jwt-token-';

export interface AuthedUser {
  id: string;
  roles: Set<string>;
  /** True when the caller authenticated with a machine key, not a user session. */
  isService?: boolean;
}

export function normalizeRole(dbRole: string): string {
  if (dbRole === 'Training Provider') return 'trainingProvider';
  return dbRole.toLowerCase();
}

function extractBearerToken(req: NextApiRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

const SERVICE_ROLES = new Set([
  'service',
  'admin',
  'trainingProvider',
  'finance',
  'payroll',
  'trainer',
  'developer',
  'learner',
]);

export async function getAuthedUser(req: NextApiRequest): Promise<AuthedUser | null> {
  // Machine callers (scheduler, OpenClaw agents) present a server-side API key.
  if (isServiceRequest(req)) {
    return { id: 'service', roles: new Set(SERVICE_ROLES), isService: true };
  }

  const token = extractBearerToken(req);
  if (!token) return null;
  // Legacy forgeable tokens are dead. Reject outright so old sessions re-login.
  if (token.startsWith(LEGACY_TOKEN_PREFIX)) return null;
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;

  try {
    const tokenHash = hashSessionToken(token);
    const r = await pool.query(
      `SELECT au.id
         FROM user_session s
         JOIN app_user au ON au.id = s.user_id
        WHERE s.token_hash = $1
          AND s.expires_at > now()
          AND (au.account_status IS NULL OR LOWER(au.account_status) = 'active')`,
      [tokenHash]
    );
    if (r.rowCount === 0) return null;
    const id: string = r.rows[0].id;

    // Touch last_used_at at most every 15 minutes; never block the request on it.
    pool
      .query(
        `UPDATE user_session
            SET last_used_at = now()
          WHERE token_hash = $1
            AND (last_used_at IS NULL OR last_used_at < now() - interval '15 minutes')`,
        [tokenHash]
      )
      .catch(() => {});

    const rolesRes = await pool.query(
      `SELECT role FROM public.user_role_map WHERE user_id = $1`,
      [id]
    );
    const roles = new Set<string>(
      rolesRes.rows.map((row: { role: string }) => normalizeRole(row.role))
    );
    if (roles.size === 0) roles.add('learner');
    return { id, roles };
  } catch (e) {
    console.error('getAuthedUser: lookup failed', e);
    return null;
  }
}

export async function requireRole(
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: string[]
): Promise<AuthedUser | null> {
  const user = await getAuthedUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return null;
  }
  const ok = user.isService || allowed.some((r) => user.roles.has(r));
  if (!ok) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  return user;
}
