import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { bulkProcessCompanyApplications } from '../../../lib/autoEnrolCompanyApplications';

/**
 * POST /api/admin/ca-retry-row
 *
 * Body: { applicationId: string }
 *
 * One-click retry for a failed/stuck company_application row. Resets the
 * row to 'pending', clears the prior error, and re-queues it through the
 * same `bulkProcessCompanyApplications` worker that the upload endpoint
 * uses. Existing context (enrolment_id, grant_id, invoice_id) is preserved
 * — the worker is idempotent and will skip steps already completed.
 *
 * Designed as the fix-it button for admins on rows showing
 * `auto_enrol_status='failed'` — saves them from the current "delete +
 * re-upload" workaround that loses everything.
 *
 * Fires the work in the background (setImmediate) so the HTTP response
 * returns quickly; the admin can poll the row's status to see progress.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const applicationId = String(req.body?.applicationId || '').trim();
    if (!applicationId) {
      return res.status(400).json({ success: false, error: 'applicationId is required' });
    }

    // Reset the row so the worker treats it as a fresh attempt. Clearing
    // the error too — if it fails again the worker will set a new one.
    const rowRes = await pool.query(
      `UPDATE public.company_application
          SET auto_enrol_status = 'pending',
              auto_enrol_error  = NULL,
              updated_at        = now()
        WHERE id = $1
        RETURNING id`,
      [applicationId]
    );
    if (rowRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Company application row not found' });
    }

    // Kick the worker in the background — same pattern as the upload route.
    setImmediate(() => {
      bulkProcessCompanyApplications([applicationId]).catch(err => {
        console.error('[ca-retry-row] background processing error:', err instanceof Error ? err.message : err);
      });
    });

    return res.status(200).json({ success: true, requeued: true, applicationId });
  } catch (err) {
    console.error('ca-retry-row error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retry row',
    });
  }
}
