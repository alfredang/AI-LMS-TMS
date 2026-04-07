import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid webhook token' });
  }

  try {
    // Look up webhook
    const { rows } = await pool.query('SELECT * FROM webhooks WHERE endpoint_token = $1', [token]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const webhook = rows[0];

    if (!webhook.enabled) {
      return res.status(403).json({ success: false, error: 'Webhook is disabled' });
    }

    // Check HTTP method matches
    if (req.method !== webhook.http_method && req.method !== 'OPTIONS') {
      return res.status(405).json({ success: false, error: `This webhook only accepts ${webhook.http_method} requests` });
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(200).end();
    }

    // Check auth token if configured
    if (webhook.auth_token) {
      const authHeader = req.headers['authorization'] || '';
      const providedToken = authHeader.replace(/^Bearer\s+/i, '');
      if (providedToken !== webhook.auth_token) {
        await pool.query(
          `INSERT INTO webhook_logs (webhook_id, http_method, headers, query_params, body, source_ip, status_code, error_message)
           VALUES ($1, $2, $3, $4, $5, $6, 401, 'Unauthorized')`,
          [webhook.id, req.method, JSON.stringify(req.headers), JSON.stringify(req.query), JSON.stringify(req.body || null),
           req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '']
        );
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
    }

    // Log the incoming request
    const responseBody = { success: true, message: 'Webhook received', webhook: webhook.name, timestamp: new Date().toISOString() };

    await pool.query(
      `INSERT INTO webhook_logs (webhook_id, http_method, headers, query_params, body, source_ip, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6, 200, $7)`,
      [webhook.id, req.method, JSON.stringify(req.headers), JSON.stringify(req.query),
       JSON.stringify(req.body || null), req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
       JSON.stringify(responseBody)]
    );

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(responseBody);

  } catch (error) {
    console.error('Webhook endpoint error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
