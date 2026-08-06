import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

type ResultItem = { claimId: string; status: 'created' | 'exists' | 'invalid' | 'error'; message?: string };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { claimIds } = req.body as { claimIds?: unknown };
    if (!Array.isArray(claimIds)) {
      return res.status(400).json({ error: 'claimIds must be an array of strings' });
    }

    const ids: string[] = Array.from(new Set(
      claimIds
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0)
    ));

    if (ids.length === 0) {
      return res.status(400).json({ error: 'No valid claim IDs provided' });
    }

    const client = await pool.connect();
    try {
      const results: ResultItem[] = [];

      for (const id of ids) {
        try {
          const exists = await client.query('SELECT 1 FROM ssg_claims WHERE claim_id = $1', [id]);
          if (exists.rowCount && exists.rowCount > 0) {
            results.push({ claimId: id, status: 'exists' });
            continue;
          }
          await client.query('INSERT INTO ssg_claims (claim_id) VALUES ($1)', [id]);
          results.push({ claimId: id, status: 'created' });
        } catch (e: any) {
          const message = e?.message || 'Database error';
          // Treat invalid values separately if needed
          results.push({ claimId: id, status: 'error', message });
        }
      }

      return res.status(200).json({
        success: true,
        data: { results },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error in claim-check:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
