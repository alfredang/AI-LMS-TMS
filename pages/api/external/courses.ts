import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/external/courses
 *
 * Course-level catalog feed for external integrations (e.g. n8n). One row per
 * course. Reuses the shared external API key (x-api-key === EXTERNAL_API_KEY_FOR_CLAWDBOT).
 *
 * Query params (all optional):
 *   page         0-based page index (default 0)
 *   limit        page size (default 500, max 1000)
 *   course_code  exact course_code filter
 *   search       ILIKE match on title or course_code
 *   fields       comma-separated subset of columns to return (from the allow-list
 *                below). Omit for the full row. Lets lightweight consumers (e.g. an
 *                n8n AI-agent search tool) fetch only what they need and skip the
 *                heavy description/outline/outcomes text.
 *
 * Trainer selection (1 trainer per course): among the course's runs that have a
 * trainer, prefer a TPG-assigned trainer; otherwise take the latest assigned
 * (local) trainer. "Latest" = most recent run by start_date, then updated_at.
 * Name/email prefer the TPG value, falling back to the local assignment.
 */

// Output field name -> SQL select expression. Identifiers come ONLY from this
// server-defined allow-list (never from the raw query string).
const FIELD_MAP: Record<string, string> = {
  course_id: 'c.id AS course_id',
  title: 'c.title',
  course_code: 'c.course_code',
  domain: 'c.domain',
  course_type: 'c.course_type',
  trainer_name: 't.trainer_name',
  trainer_email: 't.trainer_email',
  courseware_link: 'c.courseware_link',
  course_fee: 'c.course_fee',
  course_fees_include_gst: 'c.course_fees_include_gst',
  course_fees_exclude_gst: 'c.course_fees_exclude_gst',
  after_normal_funding: 'c.after_normal_funding',
  after_mces_funding: 'c.after_mces_funding',
  tax_percent: 'c.tax_percent',
  training_hours: 'c.training_hours',
  assessment_hours: 'c.assessment_hours',
  num_of_days: 'c.num_of_days',
  course_link: 'c.course_link',
  brochure_link: 'c.brochure_link',
  learner_slides_url: 'c.slides_url AS learner_slides_url',
  skillsfuture_link: 'c.skillsfuture_link',
  sf_for_business_link: 'c.sf_for_business_link',
  description: 'c.description',
  course_outline: 'c.course_outline',
  learning_outcomes: 'c.learning_outcomes',
};
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
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const page = Math.max(parseInt(String(req.query.page ?? '0'), 10) || 0, 0);
    const rawLimit = parseInt(String(req.query.limit ?? '500'), 10) || 500;
    const limit = Math.min(Math.max(rawLimit, 1), 1000);
    const offset = page * limit;

    const courseCode = (req.query.course_code as string | undefined)?.trim() || '';
    const search = (req.query.search as string | undefined)?.trim() || '';

    // Build the SELECT list from the allow-list. Requested fields that aren't in
    // FIELD_MAP are ignored; if none are valid, fall back to the full row.
    const requestedFields = (req.query.fields as string | undefined)?.trim() || '';
    const picked = requestedFields
      ? requestedFields.split(',').map((f) => f.trim()).filter((f) => FIELD_MAP[f])
      : [];
    const selectClause = (picked.length > 0 ? picked : Object.keys(FIELD_MAP))
      .map((f) => FIELD_MAP[f])
      .join(',\n         ');

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;
    if (courseCode) {
      conditions.push(`c.course_code = $${idx++}`);
      params.push(courseCode);
    }
    if (search) {
      conditions.push(`(c.title ILIKE $${idx} OR c.course_code ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataResult = await pool.query(
      `SELECT
         ${selectClause}
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
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM course c ${where}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    return res.status(200).json({
      success: true,
      pagination: { page, limit, total, returned: dataResult.rows.length },
      data: dataResult.rows,
    });
  } catch (err) {
    console.error('external/courses error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
