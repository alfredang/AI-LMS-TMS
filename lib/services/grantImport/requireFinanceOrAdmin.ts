import type { NextApiRequest } from 'next';
import pool from '@/lib/db';

/**
 * Server-side guard for finance/admin-only endpoints.
 *
 * Current auth in this repo is inconsistent across routes; for safety we require an explicit actorUserId
 * and verify it has Finance or Admin role in user_role_map.
 */
export async function requireFinanceOrAdmin(req: NextApiRequest): Promise<{ actorUserId: string }> {
  const actorUserId =
    (typeof req.headers['x-actor-user-id'] === 'string' && req.headers['x-actor-user-id'].trim()) ||
    (typeof (req.body as any)?.actorUserId === 'string' && (req.body as any).actorUserId.trim()) ||
    '';

  if (!actorUserId) {
    throw new Error('Missing actorUserId (set header x-actor-user-id or include actorUserId in body).');
  }

  const r = await pool.query(
    `SELECT 1
     FROM public.user_role_map
     WHERE user_id = $1::uuid
       AND role IN ('Finance', 'Admin')
     LIMIT 1`,
    [actorUserId]
  );

  if (r.rows.length === 0) {
    throw new Error('Unauthorized: finance/admin role required.');
  }

  return { actorUserId };
}

