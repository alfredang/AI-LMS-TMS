import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await pool.query("SELECT value FROM app_config WHERE key = 'commit_hash'");
    const commitHash = result.rows[0]?.value || process.env.NEXT_PUBLIC_COMMIT_HASH || 'dev';
    return res.status(200).json({ version: commitHash });
  } catch {
    return res.status(200).json({ version: process.env.NEXT_PUBLIC_COMMIT_HASH || 'dev' });
  }
}
