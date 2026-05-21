import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';

const TOKEN_PREFIX = 'mock-jwt-token-';

export interface AuthedUser {
  id: string;
  roles: Set<string>;
}

function normalizeRole(dbRole: string): string {
  if (dbRole === 'Training Provider') return 'trainingProvider';
  return dbRole.toLowerCase();
}

function extractUserId(req: NextApiRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const id = token.slice(TOKEN_PREFIX.length);
  return id ? id : null;
}

export async function getAuthedUser(req: NextApiRequest): Promise<AuthedUser | null> {
  const id = extractUserId(req);
  if (!id) return null;
  try {
    const r = await pool.query(
      `SELECT au.id
         FROM app_user au
        WHERE au.id = $1
          AND (au.account_status IS NULL OR LOWER(au.account_status) = 'active')`,
      [id]
    );
    if (r.rowCount === 0) return null;

    const rolesRes = await pool.query(
      `SELECT role FROM public.user_role_map WHERE user_id = $1`,
      [id]
    );
    const roles = new Set<string>(rolesRes.rows.map((row: { role: string }) => normalizeRole(row.role)));
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
  const ok = allowed.some((r) => user.roles.has(r));
  if (!ok) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  return user;
}
