import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/external/course-info
 *
 * Single-course lookup for external automations (e.g. the n8n "Auto Reply for
 * SSG Course Enquiry" flow). Returns ONE live course row as a flat object
 * (not wrapped in a paginated array), so downstream expressions can read
 * fields directly, e.g. {{ $json.title }} / {{ $json.skillsfuture_link }}.
 *
 * Always live from the Coolify DB — no manually-maintained data table to go stale.
 *
 * Auth: x-api-key === EXTERNAL_API_KEY_FOR_CLAWDBOT (same key as the other
 * /api/external/* routes).
 *
 * Query params (one of course_code / search is required):
 *   course_code  exact course_code match, e.g. TGS-2025052468 (preferred)
 *   search       ILIKE match on title or course_code; returns the best (A–Z first) match
 *
 * Responses:
 *   200 { success: true, data: { ...course fields... } }
 *   400 { success: false, error }   — no lookup key supplied
 *   401 { success: false, error }   — bad/missing API key
 *   404 { success: false, error }   — no matching course
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  const courseCode = (req.query.course_code as string | undefined)?.trim() || '';
  const search = (req.query.search as string | undefined)?.trim() || '';

  if (!courseCode && !search) {
    return res.status(400).json({ success: false, error: 'course_code or search is required' });
  }

  try {
    const params: string[] = [];
    let where: string;
    if (courseCode) {
      params.push(courseCode);
      // Match any code the course has carried; SSG renewals issue a new reference
      // number and callers paste whichever one they are holding.
      where = `WHERE c.id = (SELECT h.course_id FROM course_code_history h WHERE h.code = $1)
                  OR c.course_code = $1
                  OR NULLIF(c.new_course_code, '') = $1`;
    } else {
      params.push(`%${search}%`);
      where = `WHERE (c.title ILIKE $1 OR c.course_code ILIKE $1)`;
    }

    const result = await pool.query(
      `SELECT
         c.id              AS course_id,
         c.title,
         c.course_code,
         c.domain,
         c.course_type,
         t.trainer_name,
         t.trainer_email,
         c.course_fee,
         c.course_fees_include_gst,
         c.course_fees_exclude_gst,
         c.after_normal_funding,
         c.after_mces_funding,
         c.tax_percent,
         c.training_hours,
         c.assessment_hours,
         c.num_of_days,
         c.course_link,
         c.brochure_link,
         c.skillsfuture_link,
         c.sf_for_business_link,
         c.description,
         c.course_outline,
         c.learning_outcomes
       FROM course c
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(NULLIF(btrim(cr.tpg_assigned_trainer_name), ''),  NULLIF(btrim(cr.assigned_trainer_name), ''))  AS trainer_name,
           COALESCE(NULLIF(btrim(cr.tpg_assigned_trainer_email), ''), NULLIF(btrim(cr.assigned_trainer_email), '')) AS trainer_email
         FROM course_run cr
         WHERE cr.course_id = c.id
           AND COALESCE(NULLIF(btrim(cr.tpg_assigned_trainer_name), ''), NULLIF(btrim(cr.assigned_trainer_name), '')) IS NOT NULL
         ORDER BY (NULLIF(btrim(cr.tpg_assigned_trainer_name), '') IS NOT NULL) DESC,
                  cr.start_date DESC NULLS LAST,
                  cr.updated_at DESC NULLS LAST
         LIMIT 1
       ) t ON true
       ${where}
       ORDER BY c.title ASC
       LIMIT 1`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No course found for ${courseCode ? `course_code "${courseCode}"` : `search "${search}"`}`,
      });
    }

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('external/course-info error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
