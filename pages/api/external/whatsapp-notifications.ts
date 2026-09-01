import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  ensureTrainerWhatsappTable,
  secondsUntilWhatsappWindow,
  WHATSAPP_CHANNELS,
  WHATSAPP_MIN_GAP_MINUTES,
  WHATSAPP_PENDING_TTL_HOURS,
} from '../../../lib/trainerWhatsapp';

/**
 * External API — Trainer WhatsApp Notification Queue (rate-gated dispatcher)
 *
 * Consumed by the OpenClaw agent (Tael), which delivers each released message
 * to the trainer's phone from the WhatsApp Business number +65 8866 6375 and
 * reports the outcome back. The LMS only queues; it never sends WhatsApp
 * itself (architecture invariant: agents integrate over the HTTPS API).
 *
 * HARD ANTI-BAN RULES (Dr Ang, 2026-09-01 — Facebook bans bursty WABA numbers),
 * enforced per CHANNEL, server-side — an over-eager poller just gets
 * rateLimited responses:
 *   - channel=invitation (default; kinds invitation+reminder):
 *       max 5/SGT day, window 10:00–13:00 SGT
 *   - channel=class_reminder (upcoming-class reminders):
 *       max 7/SGT day, window 13:00–17:00 SGT
 *   - GLOBAL: at least 15 minutes between ANY two releases (same WABA
 *     number), one message per poll
 * Pending rows older than 72h are expired unsent (stale nudges are noise).
 *
 * GET  /api/external/whatsapp-notifications?channel=invitation|class_reminder
 *   → releases 0 or 1 message: { success, notifications:[...1], sentToday, dailyCap, minGapMinutes }
 *     or { success, notifications:[], rateLimited:true, reason:'daily_cap'|'min_gap'|'outside_window', retryAfterSeconds? }
 * GET  ?status=dispatched|sent|failed|no_phone|expired (read-only audit listing)
 *
 * POST /api/external/whatsapp-notifications
 *   Body: { id: string, status: 'sent' | 'failed', error?: string }
 *   → confirms the outcome of a released row; 'sent' stamps sent_at.
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
    if (!['pending', 'sent', 'failed', 'no_phone', 'dispatched', 'expired'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be pending|dispatched|sent|failed|no_phone|expired' });
    }

    const mapRow = (r: any) => ({
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
      dispatchedAt: r.dispatched_at,
      sentAt: r.sent_at,
    });

    // Non-pending statuses: plain read-only listing (audit/monitoring).
    if (status !== 'pending') {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
      const rows = await pool.query(
        `SELECT n.*, cr.course_run_id
           FROM trainer_whatsapp_notification n
           LEFT JOIN course_run cr ON cr.id = n.course_run_id
          WHERE n.status = $1
          ORDER BY n.created_at DESC
          LIMIT $2`,
        [status, limit]
      );
      return res.status(200).json({ success: true, count: rows.rows.length, notifications: rows.rows.map(mapRow) });
    }

    // ── Dispatch mode (status=pending) — HARD anti-ban gate ─────────────────
    // Per-channel caps/windows + a GLOBAL 15-min gap (same WABA number).
    // Every released row is stamped dispatched_at and counts toward the caps
    // whatever its final outcome (sent/failed) — the WABA hit already happened.
    const channelName = typeof req.query.channel === 'string' ? req.query.channel : 'invitation';
    const channel = WHATSAPP_CHANNELS[channelName];
    if (!channel) {
      return res.status(400).json({
        success: false,
        error: `channel must be one of: ${Object.keys(WHATSAPP_CHANNELS).join(', ')}`,
      });
    }

    // Housekeeping 1: expire stale pending rows (a days-late nudge is noise).
    await pool.query(
      `UPDATE trainer_whatsapp_notification
          SET status = 'expired', error = 'Expired unsent after ${WHATSAPP_PENDING_TTL_HOURS}h (rate cap backlog)'
        WHERE status = 'pending' AND created_at < NOW() - INTERVAL '${WHATSAPP_PENDING_TTL_HOURS} hours'`
    );
    // Housekeeping 2: a dispatched row never confirmed within 6h is marked
    // failed so the queue can't wedge (it still counts toward the caps).
    await pool.query(
      `UPDATE trainer_whatsapp_notification
          SET status = 'failed', error = COALESCE(error, 'Dispatch not confirmed by agent within 6h')
        WHERE status = 'dispatched' AND dispatched_at < NOW() - INTERVAL '6 hours'`
    );

    // Sending window for THIS channel.
    const windowWait = secondsUntilWhatsappWindow(channel.windowStartHourSgt, channel.windowEndHourSgt);
    if (windowWait !== null) {
      return res.status(200).json({
        success: true, count: 0, notifications: [],
        channel: channelName,
        rateLimited: true, reason: 'outside_window',
        retryAfterSeconds: windowWait,
        message: `${channelName} WhatsApp messages are only sent between ${channel.windowStartHourSgt}:00 and ${channel.windowEndHourSgt}:00 SGT`,
      });
    }

    const gate = await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE kind = ANY($1::text[])
             AND (dispatched_at AT TIME ZONE 'Asia/Singapore')::date = (NOW() AT TIME ZONE 'Asia/Singapore')::date
         )::int AS today_count,
         MAX(dispatched_at) AS last_dispatched_at
       FROM trainer_whatsapp_notification
       WHERE dispatched_at IS NOT NULL`,
      [channel.kinds]
    );
    // Daily cap is per channel; the 15-min gap is GLOBAL across channels —
    // both go out from the same WhatsApp Business number.
    const todayCount = gate.rows[0]?.today_count ?? 0;
    const lastAt = gate.rows[0]?.last_dispatched_at ? new Date(gate.rows[0].last_dispatched_at) : null;

    if (todayCount >= channel.maxPerDay) {
      return res.status(200).json({
        success: true, count: 0, notifications: [],
        channel: channelName,
        rateLimited: true, reason: 'daily_cap',
        message: `Daily cap of ${channel.maxPerDay} ${channelName} WhatsApp messages reached — try again tomorrow (SGT)`,
        sentToday: todayCount,
      });
    }
    if (lastAt) {
      const elapsedMs = Date.now() - lastAt.getTime();
      const gapMs = WHATSAPP_MIN_GAP_MINUTES * 60 * 1000;
      if (elapsedMs < gapMs) {
        return res.status(200).json({
          success: true, count: 0, notifications: [],
          channel: channelName,
          rateLimited: true, reason: 'min_gap',
          retryAfterSeconds: Math.ceil((gapMs - elapsedMs) / 1000),
          message: `Messages must be ${WHATSAPP_MIN_GAP_MINUTES} minutes apart (any channel) — retry later`,
          sentToday: todayCount,
        });
      }
    }

    // Release exactly ONE message from this channel, race-safe (SKIP LOCKED).
    const released = await pool.query(
      `UPDATE trainer_whatsapp_notification n
          SET status = 'dispatched', dispatched_at = NOW()
        WHERE n.id = (
          SELECT id FROM trainer_whatsapp_notification
           WHERE status = 'pending' AND kind = ANY($1::text[])
           ORDER BY created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING n.*, (SELECT cr.course_run_id FROM course_run cr WHERE cr.id = n.course_run_id) AS course_run_id`,
      [channel.kinds]
    );
    return res.status(200).json({
      success: true,
      count: released.rows.length,
      notifications: released.rows.map(mapRow),
      channel: channelName,
      sentToday: todayCount + released.rows.length,
      dailyCap: channel.maxPerDay,
      minGapMinutes: WHATSAPP_MIN_GAP_MINUTES,
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
