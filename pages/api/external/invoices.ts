import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List Invoices
 *
 * GET /api/external/invoices
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params (all optional):
 *   learner_email  — filter by learner email
 *   course_code    — filter by course code / SKU
 *   status         — filter by invoice job status (queued | running | done | failed)
 *   limit          — max rows (default 100, max 500)
 *   offset         — pagination offset (default 0)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { learner_email, course_code, status } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (learner_email) {
      conditions.push(`LOWER(ij.learner_email) = LOWER($${idx++})`);
      params.push(String(learner_email));
    }
    if (course_code) {
      conditions.push(`ij.course_code = $${idx++}`);
      params.push(String(course_code));
    }
    if (status) {
      conditions.push(`ij.status = $${idx++}`);
      params.push(String(status));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         ij.id,
         ij.enrolment_id,
         ij.learner_email,
         ij.course_code,
         ij.status,
         ij.invoice_no,
         ij.qbo_invoice_id,
         ij.qbo_doc_number,
         ij.drive_web_view_link,
         ij.invoice_sent_at,
         ij.invoice_sent_to,
         ij.created_at,
         ij.updated_at
       FROM invoice_jobs ij
       ${where}
       ORDER BY ij.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM invoice_jobs ij ${where}`,
      params
    );

    return res.status(200).json({
      success: true,
      total: countResult.rows[0].total,
      limit,
      offset,
      data: result.rows,
    });
  } catch (error: any) {
    // Table might not exist yet
    if (error.code === '42P01') {
      return res.status(200).json({ success: true, total: 0, limit, offset, data: [] });
    }
    console.error('external/invoices error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
