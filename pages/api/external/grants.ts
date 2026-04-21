import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List SSG Grants
 *
 * GET /api/external/grants
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params (all optional):
 *   enrollment_id  — filter by SSG enrolment reference (ENR-...)
 *   status         — filter by grant status (Pending | Approved | Rejected)
 *   funding_scheme — filter by funding_scheme_code
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

  const { enrollment_id, status, funding_scheme } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (enrollment_id) {
      conditions.push(`sg.enrollment_id = $${idx++}`);
      params.push(String(enrollment_id));
    }
    if (status) {
      conditions.push(`sg.status = $${idx++}`);
      params.push(String(status));
    }
    if (funding_scheme) {
      conditions.push(`sg.funding_scheme_code = $${idx++}`);
      params.push(String(funding_scheme));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         sg.id,
         sg.enrollment_id,
         sg.grant_id,
         sg.status,
         sg.funding_scheme_code,
         sg.funding_scheme_description,
         sg.component_code,
         sg.component_description,
         sg.estimated_grant_amount,
         sg.approved_grant_amount,
         sg.created_date,
         sg.imported_at,
         sg.api_response->'trainee'->>'name' AS trainee_name,
         sg.api_response->'trainee'->>'idNumber' AS trainee_nric
       FROM ssg_grants sg
       ${where}
       ORDER BY sg.created_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    // Summary stats
    const statsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_grants,
         COALESCE(SUM(sg.estimated_grant_amount), 0) AS total_estimated,
         COALESCE(SUM(sg.approved_grant_amount), 0) AS total_approved,
         COUNT(*) FILTER (WHERE sg.status = 'Pending')::int AS pending_count,
         COUNT(*) FILTER (WHERE sg.status = 'Approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE sg.status = 'Rejected')::int AS rejected_count
       FROM ssg_grants sg
       ${where}`,
      params
    );

    return res.status(200).json({
      success: true,
      summary: statsResult.rows[0],
      limit,
      offset,
      data: result.rows,
    });
  } catch (error) {
    console.error('external/grants error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
