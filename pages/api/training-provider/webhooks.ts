import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const { rows } = await pool.query(`
          SELECT w.*,
            (SELECT received_at FROM webhook_logs WHERE webhook_id = w.id ORDER BY received_at DESC LIMIT 1) as last_called,
            (SELECT COUNT(*) FROM webhook_logs WHERE webhook_id = w.id)::int as call_count
          FROM webhooks w ORDER BY w.created_at DESC
        `);
        return res.status(200).json({ success: true, webhooks: rows });
      }

      case 'POST': {
        const { name, description, http_method, auth_token } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'name is required' });

        const endpoint_token = crypto.randomBytes(16).toString('hex');
        const { rows } = await pool.query(
          `INSERT INTO webhooks (name, description, http_method, endpoint_token, auth_token) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [name, description || null, http_method || 'POST', endpoint_token, auth_token || null]
        );
        return res.status(201).json({ success: true, webhook: rows[0] });
      }

      case 'PUT': {
        const { id, name, description, http_method, auth_token, enabled } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });

        const { rows } = await pool.query(
          `UPDATE webhooks SET name = COALESCE($2, name), description = COALESCE($3, description),
           http_method = COALESCE($4, http_method), auth_token = $5, enabled = COALESCE($6, enabled),
           updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id, name, description, http_method, auth_token ?? null, enabled]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Webhook not found' });
        return res.status(200).json({ success: true, webhook: rows[0] });
      }

      case 'DELETE': {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });
        await pool.query('DELETE FROM webhooks WHERE id = $1', [id]);
        return res.status(200).json({ success: true });
      }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Webhook CRUD error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal error' });
  }
}
