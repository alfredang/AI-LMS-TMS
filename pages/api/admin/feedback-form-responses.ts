import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = req.body || {};
  const ids: unknown = body.ids ?? (typeof req.query.id === 'string' ? [req.query.id] : []);

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(x => typeof x === 'string')) {
    return res.status(400).json({ success: false, error: 'ids (string[]) is required' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM feedback_form_response WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids]
    );
    return res.status(200).json({ success: true, deleted: result.rowCount, ids: result.rows.map(r => r.id) });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
