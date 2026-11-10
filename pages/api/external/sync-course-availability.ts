import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { refreshCourseAvailabilityBatch } from '../../../lib/ssg/courseAvailability';

type StorefrontAvailability = {
  course_code: string;
  ssg_course_code: string;
  status: string;
  reason: string | null;
  support_from: string | null;
  support_to: string | null;
  has_future_run: boolean;
  checked_at: string;
};

async function pushAvailabilityToStorefront(courses: StorefrontAvailability[]) {
  const provider = await pool.query<{
    tertiary_courses_sg_url: string | null;
    tertiary_courses_sg_api_key: string | null;
    magento_backend_url: string | null;
  }>(
    `SELECT tertiary_courses_sg_url, tertiary_courses_sg_api_key, magento_backend_url
       FROM training_provider LIMIT 1`,
  );
  const baseUrl = provider.rows[0]?.tertiary_courses_sg_url || provider.rows[0]?.magento_backend_url || '';
  const apiKey = provider.rows[0]?.tertiary_courses_sg_api_key || '';
  if (!baseUrl || !apiKey) {
    throw new Error('Tertiary Courses SG URL or API key is not configured (Company Settings -> Integrations).');
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/courses/api_availability`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      source: 'tms-ssg',
      generated_at: new Date().toISOString(),
      courses,
    }),
    cache: 'no-store',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Magento availability API ${response.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    return { success: true, response: body.slice(0, 300) };
  }
}

/** Daily SSG -> TMS -> storefront reconciliation. */
export async function runAutomation() {
  const refreshedBefore = new Date().toISOString();
  const totals: Record<string, number> = {};
  let remaining = 0;
  let rounds = 0;

  for (let attempt = 0; attempt < 20; attempt++) {
    rounds = attempt + 1;
    const result = await refreshCourseAvailabilityBatch({ batchSize: 50, refreshedBefore });
    for (const [key, value] of Object.entries(result.summary)) {
      totals[key] = (totals[key] || 0) + value;
    }
    remaining = result.remaining;
    const progress = result.summary.updated + result.summary.no_wsq_support;
    if (remaining === 0 || progress === 0) break;
  }

  const rows = await pool.query<StorefrontAvailability>(
    `SELECT c.course_code,
            COALESCE(
              (SELECT h.code FROM course_code_history h
                WHERE h.course_id = c.id AND h.is_current LIMIT 1),
              NULLIF(c.new_course_code, ''),
              c.course_code
            ) AS ssg_course_code,
            COALESCE(c.course_availability_status, 'unknown') AS status,
            COALESCE(c.course_availability_reason, 'SSG availability has not been confirmed yet.') AS reason,
            c.ssg_wsq_support_from::text AS support_from,
            c.ssg_wsq_support_to::text AS support_to,
            COALESCE(c.ssg_has_future_run, false) AS has_future_run,
            COALESCE(c.course_availability_checked_at, NOW())::text AS checked_at
       FROM course c
      WHERE c.course_code LIKE 'TGS-%'
      ORDER BY c.course_code`,
  );

  const storefront = await pushAvailabilityToStorefront(rows.rows);
  return {
    status: remaining === 0 ? 'completed' : 'partial',
    rounds,
    remaining,
    refreshed: totals,
    pushed: rows.rows.length,
    storefront,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!req.headers['x-api-key'] || req.headers['x-api-key'] !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  try {
    return res.status(200).json({ success: true, ...(await runAutomation()) });
  } catch (error) {
    console.error('sync-course-availability error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
