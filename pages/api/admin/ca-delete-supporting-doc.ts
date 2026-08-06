import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';

/**
 * POST /api/admin/ca-delete-supporting-doc
 *
 * Body: { companyApplicationId: uuid }
 *
 * Removes the uploaded supporting doc for a company_application row:
 *   - Best-effort delete of the Drive file (failures logged, not fatal — the
 *     row reference is cleared either way so the admin can re-upload).
 *   - Clears supporting_doc_drive_file_id / web_view_link / uploaded_at.
 *   - Resets verification status / verified_at / verified_by to NULL.
 *
 * Unlike the 'mismatch' verdict (which clears the doc AND flags the row),
 * this is a plain undo — the row returns to a fresh "no doc, not yet
 * reviewed" state so the admin can start over.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const companyApplicationId = String(req.body?.companyApplicationId || '').trim();
    if (!companyApplicationId) {
      return res.status(400).json({ success: false, error: 'companyApplicationId is required' });
    }

    const rowRes = await pool.query(
      `SELECT id, supporting_doc_drive_file_id
         FROM public.company_application
        WHERE id = $1`,
      [companyApplicationId]
    );
    const row = rowRes.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, error: 'Company application row not found' });
    }

    const fileId = row.supporting_doc_drive_file_id ? String(row.supporting_doc_drive_file_id) : '';
    let driveDeleted = false;
    let driveError: string | null = null;
    if (fileId) {
      try {
        const drive = await getDriveClient();
        await drive.files.delete({ fileId });
        driveDeleted = true;
      } catch (err) {
        // Drive failure (file already deleted, permission issue, etc.) is
        // non-fatal — we still clear the row reference so the admin's UI
        // unblocks for a re-upload.
        driveError = err instanceof Error ? err.message : 'Drive delete failed';
        console.warn('[ca-delete-supporting-doc] Drive delete failed:', driveError);
      }
    }

    await pool.query(
      `UPDATE public.company_application
          SET supporting_doc_drive_file_id        = NULL,
              supporting_doc_drive_web_view_link  = NULL,
              supporting_doc_uploaded_at          = NULL,
              supporting_doc_verification_status  = NULL,
              supporting_doc_verified_at          = NULL,
              supporting_doc_verified_by          = NULL,
              updated_at                          = now()
        WHERE id = $1`,
      [companyApplicationId]
    );

    return res.status(200).json({
      success: true,
      driveDeleted,
      driveError,
    });
  } catch (err: any) {
    console.error('ca-delete-supporting-doc error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete supporting doc',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
