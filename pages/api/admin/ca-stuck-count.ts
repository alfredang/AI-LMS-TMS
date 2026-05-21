import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

/**
 * GET /api/admin/ca-stuck-count
 *
 * Returns the count of company_application rows that need admin attention —
 * either auto-enrolment failed outright, or the SSG enrolment succeeded but a
 * downstream pipeline step (grant fetch, calendar sync, native LMS enrolment,
 * partial grant upsert) wrote a non-blocking warning.
 *
 * Drives the red badge on the "View Company Application" sidebar nav item.
 * Kept as a separate endpoint from fetch-company-applications.ts so the
 * sidebar can poll cheaply without re-shipping ~40 columns per row.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    await ensureCompanyApplicationsTable();
    const result = await pool.query(`
      SELECT COUNT(*)::int AS count
        FROM public.company_application
       WHERE LOWER(COALESCE(auto_enrol_status, '')) = 'failed'
          OR jsonb_array_length(COALESCE(pipeline_warnings, '[]'::jsonb)) > 0
    `);
    return res.status(200).json({ count: result.rows[0]?.count ?? 0 });
  } catch (err: any) {
    console.error('ca-stuck-count error:', err);
    return res.status(500).json({ count: 0, error: err?.message || 'Failed' });
  }
}
