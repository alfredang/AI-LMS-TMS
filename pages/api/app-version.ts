import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return res.status(200).json({ version: process.env.NEXT_PUBLIC_COMMIT_HASH || 'dev' });
  } catch {
    return res.status(200).json({ version: 'dev' });
  }
}
