import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { bulkProcessDirectApplications } from '../../../lib/autoEnrolDirectApplications';
import { retryFailedCalendarSyncs } from '../../../lib/google-calendar/da-calendar-sync';

/**
 * POST /api/admin/auto-enrol-direct-applications
 *
 * Body:
 *   { applicationIds?: string[] }
 *
 * If applicationIds is omitted, queues all da_application rows that are
 * eligible for retry (auto_enrol_status IS NULL OR 'failed') and whose
 * application_status is 'Confirm application'.
 *
 * Responds immediately with { success, queued } — the pipeline runs in the
 * background (fire-and-forget). Clients can poll fetch-all-da-applications
 * to watch auto_enrol_status progress.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { applicationIds } = req.body || {};

    let ids: string[] = [];

    if (Array.isArray(applicationIds) && applicationIds.length > 0) {
      ids = applicationIds.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0);
    } else {
      const result = await pool.query(
        `SELECT id FROM da_application
         WHERE (auto_enrol_status IS NULL OR auto_enrol_status = 'failed')
           AND LOWER(application_status) = 'confirm application'
         ORDER BY created_at ASC`
      );
      ids = result.rows.map(r => r.id);
    }

    if (ids.length === 0) {
      return res.status(200).json({ success: true, queued: 0, message: 'No eligible rows' });
    }

    // Fire-and-forget — do NOT await
    setImmediate(() => {
      bulkProcessDirectApplications(ids).catch(err => {
        console.error('❌ auto-enrol background batch failed:', err);
      });
      
      // Also run the background sweep for any applications that missed the calendar step
      retryFailedCalendarSyncs().catch(err => {
        console.error('❌ calendar retry sweep background batch failed:', err);
      });
    });

    return res.status(200).json({ success: true, queued: ids.length });
  } catch (error) {
    console.error('❌ auto-enrol-direct-applications error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
