import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Called by HRMS whenever it rotates the QB refresh token.
// Keeps the reference project credential table in sync so both apps always have the latest token.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.TOKEN_SYNC_SECRET;
  if (!secret) return res.status(500).json({ error: 'TOKEN_SYNC_SECRET not configured' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    await pool.query(
      `UPDATE training_provider_api
       SET key_value = $1
       WHERE key_name IN ('QUICKBOOKS_REFRESH_TOKEN', 'QUICKBOOKS_APP1_REFRESH_TOKEN')`,
      [refreshToken],
    );
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'DB error' });
  }
}
