// pages/api/admin/auto-enrol-company-applications.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { bulkProcessCompanyApplications } from '../../../lib/autoEnrolCompanyApplications';

/**
 * POST /api/admin/auto-enrol-company-applications
 *
 * Body:
 *   { applicationIds?: string[] }
 *
 * If applicationIds is omitted, queues every company_application row that
 * still has an outstanding step (SSG enrolment, calendar add, or grant
 * lookup). Backs the "Sync Now" button on the View Company Application page.
 */
async function selectIncompleteCompanyApplicationIds(): Promise<string[]> {
  // Pick rows that still have a step outstanding. The 30-second updated_at
  // floor prevents the click from racing with a still-in-flight pipeline run.
  // No time gate on the grant branch — grants are applied manually by
  // stakeholders in the SSG portal (no API), so Sync Now needs to re-check
  // on demand whenever the admin presses it.
  const result = await pool.query(
    `SELECT id
       FROM public.company_application
      WHERE COALESCE(TRIM(trainee_nric), '') <> ''
        AND COALESCE(TRIM(course_title), '') <> ''
        AND updated_at < NOW() - INTERVAL '30 seconds'
        AND (
          COALESCE(TRIM(enrolment_id), '') = ''
          OR (COALESCE(TRIM(enrolment_id), '') <> '' AND calendar_added IS NOT TRUE)
          OR (COALESCE(TRIM(enrolment_id), '') <> '' AND COALESCE(TRIM(grant_id), '') = '')
        )
      ORDER BY created_at ASC`
  );
  return result.rows.map((row: { id: string }) => row.id);
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    await ensureCompanyApplicationsTable();

    const { applicationIds } = req.body || {};

    let ids: string[] = [];

    if (Array.isArray(applicationIds) && applicationIds.length > 0) {
      ids = applicationIds.filter(
        (x: unknown): x is string =>
          typeof x === 'string' && x.trim().length > 0
      );
    } else {
      ids = await selectIncompleteCompanyApplicationIds();
    }

    if (ids.length === 0) {
      return res.status(200).json({
        success: true,
        queued: 0,
        message: 'No eligible company application rows',
      });
    }

    setImmediate(() => {
      bulkProcessCompanyApplications(ids).catch(err => {
        console.error('❌ company auto-enrol background batch failed:', err);
      });
    });

    return res.status(200).json({
      success: true,
      queued: ids.length,
    });
  } catch (error) {
    console.error('❌ auto-enrol-company-applications error:', error);

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}