import { withAuth } from '@lib/auth/withAuth';
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
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    await ensureCompanyApplicationsTable();
    const result = await pool.query(`
      SELECT COUNT(*)::int AS count
        FROM public.company_application
       WHERE
         -- MUST match the isStuck rule in fetch-company-applications.ts. This
         -- number is a promise that the page can show you that many rows; when
         -- the two drift the badge points at rows the page then filters away,
         -- which is exactly what a badge must never do.
         (
           LOWER(COALESCE(auto_enrol_status, '')) = 'failed'
           -- Warnings only count while they are still actionable: an invoice
           -- means the run finished despite them, and a dismissal means an
           -- admin has already looked.
           OR (
                jsonb_array_length(COALESCE(pipeline_warnings, '[]'::jsonb)) > 0
            AND COALESCE(invoice_id, '') = ''
            AND attention_ignored_at IS NULL
              )
           -- Stranded: enroled with SSG but the pipeline never finished. The
           -- grant poll runs in memory, so a deploy or restart inside its
           -- 15-minute window leaves the row here with no failure and no
           -- warning. 30 minutes clears the longest legitimate wait.
           OR (
                COALESCE(enrolment_id, '') <> ''
            AND COALESCE(auto_enrol_status, '') IN ('', 'pending')
            AND updated_at < now() - interval '30 minutes'
            AND attention_ignored_at IS NULL
              )
         )
    `);
    return res.status(200).json({ count: result.rows[0]?.count ?? 0 });
  } catch (err: any) {
    console.error('ca-stuck-count error:', err);
    return res.status(500).json({ count: 0, error: err?.message || 'Failed' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
