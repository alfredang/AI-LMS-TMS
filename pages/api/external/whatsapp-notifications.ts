import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureTrainerWhatsappTable } from '../../../lib/trainerWhatsapp';

/**
 * External API — Trainer WhatsApp Notification Queue
 *
 * Consumed by the OpenClaw agent (Tael), which delivers each queued message
 * to the trainer's phone from the WhatsApp Business number +65 8866 6375 and
 * reports the outcome back. The LMS only queues; it never sends WhatsApp
 * itself (architecture invariant: agents integrate over the HTTPS API).
 *
 * GET  /api/external/whatsapp-notifications?status=pending&limit=50
 *   → { success, notifications: [{ id, trainerName, trainerPhone, message, kind, courseRunId, createdAt }] }
 *
 * POST /api/external/whatsapp-notifications
 *   Body: { id: string, status: 'sent' | 'failed', error?: string }
 *   → marks the row; 'sent' stamps sent_at.
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  await ensureTrainerWhatsappTable();

  if (req.method === 'GET') {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    if (!['pending', 'sent', 'failed', 'no_phone'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be pending|sent|failed|no_phone' });
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const rows = await pool.query(
      `SELECT n.id, n.trainer_name, n.trainer_email, n.trainer_phone, n.kind,
              n.message, n.status, n.error, n.created_at, n.sent_at,
              cr.course_run_id
         FROM trainer_whatsapp_notification n
         LEFT JOIN course_run cr ON cr.id = n.course_run_id
        WHERE n.status = $1
        ORDER BY n.created_at ASC
        LIMIT $2`,
      [status, limit]
    );
    return res.status(200).json({
      success: true,
      count: rows.rows.length,
      notifications: rows.rows.map((r: any) => ({
        id: r.id,
        trainerName: r.trainer_name,
        trainerEmail: r.trainer_email,
        trainerPhone: r.trainer_phone,
        kind: r.kind,
        message: r.message,
        status: r.status,
        error: r.error,
        courseRunId: r.course_run_id,
        createdAt: r.created_at,
        sentAt: r.sent_at,
      })),
    });
  }

  if (req.method === 'POST') {
    const { id, status, error } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, error: 'id is required' });
    }
    if (status !== 'sent' && status !== 'failed') {
      return res.status(400).json({ success: false, error: "status must be 'sent' or 'failed'" });
    }
    const upd = await pool.query(
      `UPDATE trainer_whatsapp_notification
          SET status = $2,
              error = $3,
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
        WHERE id = $1
        RETURNING id`,
      [id, status, typeof error === 'string' && error ? error.slice(0, 2000) : null]
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default handler;
