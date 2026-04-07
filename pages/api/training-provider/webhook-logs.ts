import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { webhookId, limit = '50', offset = '0' } = req.query;
  if (!webhookId) return res.status(400).json({ success: false, error: 'webhookId is required' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM webhook_logs WHERE webhook_id = $1 ORDER BY received_at DESC LIMIT $2 OFFSET $3`,
      [webhookId, parseInt(limit as string), parseInt(offset as string)]
    );
    const countRes = await pool.query('SELECT COUNT(*)::int as total FROM webhook_logs WHERE webhook_id = $1', [webhookId]);
    return res.status(200).json({ success: true, logs: rows, total: countRes.rows[0].total });
  } catch (error) {
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal error' });
  }
}
