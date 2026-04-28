import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import pool from '../../../lib/db';

/**
 * Verify that a Google Drive file still exists.
 * If permanently deleted, clears the proforma URL from enrollment and marks
 * matching invoice_jobs as failed so learner Billing History stops counting
 * deleted tax invoices as issued.
 *
 * GET /api/billing/verify-drive?url=<driveUrl>&enrollmentId=<uuid>
 * Returns { valid: true } or { valid: false }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, enrollmentId } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ valid: false });
  }

  // Extract file ID from Drive URL (e.g. /file/d/FILE_ID/view)
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return res.status(200).json({ valid: false });
  }

  const fileId = match[1];

  try {
    const drive = await getDriveClient();
    await drive.files.get({ fileId, fields: 'id' });
    return res.status(200).json({ valid: true });
  } catch (err: any) {
    // 404 = file not found (permanently deleted)
    if (err.code === 404) {
      if (enrollmentId && typeof enrollmentId === 'string') {
        await pool.query('UPDATE enrollment SET pro_forma_url = NULL WHERE id = $1', [enrollmentId]);

        await pool.query(
          `UPDATE public.invoice_jobs ij
              SET status = 'failed',
                  drive_file_id = NULL,
                  drive_web_view_link = NULL,
                  last_error = 'Google Drive invoice PDF was deleted or is no longer accessible',
                  updated_at = NOW()
            WHERE ij.status = 'done'
              AND (
                    ij.drive_file_id = $2
                 OR ij.drive_web_view_link = $3
                 OR EXISTS (
                      SELECT 1
                      FROM public.enrollment e
                      WHERE e.id = $1
                        AND LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id::text, '')))
                    )
                 OR EXISTS (
                      SELECT 1
                      FROM public.da_application da
                      WHERE da.id = $1
                        AND LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(da.enrolment_id::text, '')))
                    )
                  )`,
          [enrollmentId, fileId, url]
        );

        console.log(`[verify-drive] Cleared dead billing document for enrollment ${enrollmentId}`);
      }
      return res.status(200).json({ valid: false });
    }
    console.error('[verify-drive] Error checking file:', err.message);
    // If we can't verify (auth error etc), assume valid to avoid unnecessary regeneration
    return res.status(200).json({ valid: true });
  }
}
