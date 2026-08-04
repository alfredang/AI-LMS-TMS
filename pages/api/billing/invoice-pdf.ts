import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { qboFetchInvoicePdf } from '../../../lib/services/qboInvoiceService';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';
import { BILLING_ENR_NORM_SQL } from '../../../lib/billing/canonicalEnrolmentRef';

/**
 * GET — stream QuickBooks invoice PDF for a learner enrolment (same auth model as /api/billing/history).
 * Prefers the file in Google Drive; falls back to QBO PDF API. No LibreOffice required.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const enrolmentId = typeof req.query.enrolmentId === 'string' ? req.query.enrolmentId.trim() : '';

  if (!userId || !enrolmentId) {
    return res.status(400).json({ error: 'Missing userId or enrolmentId' });
  }

  try {
    await ensureInvoiceJobsTable();

    // Match completed job to this learner enrolment: same ENR as stored on enrollment OR canonical ENR from SSG (often differs).
    const r = await pool.query(
      `SELECT ij.drive_file_id, ij.qbo_invoice_id, ij.qbo_doc_number, ij.invoice_no
       FROM public.invoice_jobs ij
       WHERE ij.status = 'done'
         AND (
           ij.user_id = $1::uuid
           OR LOWER(TRIM(COALESCE(ij.learner_email, ''))) = (
             SELECT LOWER(TRIM(COALESCE(email::text, ''))) FROM app_user WHERE id = $1::uuid LIMIT 1
           )
         )
         AND EXISTS (
           SELECT 1
           FROM enrollment e
           JOIN app_user u ON u.id = e.user_id
           JOIN course_run cr ON cr.id = e.course_run_id
           WHERE e.user_id = $1::uuid
             AND LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM($2::text))
             AND (
               LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id::text, '')))
               OR LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = (${BILLING_ENR_NORM_SQL})
             )
         )
       ORDER BY ij.updated_at DESC
       LIMIT 1`,
      [userId, enrolmentId]
    );

    const row = r.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'No completed invoice found for this enrolment.' });
    }

    const driveFileId = row.drive_file_id ? String(row.drive_file_id).trim() : '';
    const qboId = row.qbo_invoice_id ? String(row.qbo_invoice_id).trim() : '';

    let pdf: Buffer | null = null;

    if (driveFileId) {
      try {
        const drive = await getDriveClient();
        const fileRes = await drive.files.get(
          { fileId: driveFileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        pdf = Buffer.from(fileRes.data as ArrayBuffer);
      } catch (driveErr) {
        console.warn('[billing/invoice-pdf] Drive fetch failed, will try QBO if available:', driveErr);
        if (!qboId) {
          const msg = driveErr instanceof Error ? driveErr.message : 'Drive PDF fetch failed';
          throw new Error(msg);
        }
      }
    }

    if (!pdf) {
      if (qboId) {
        pdf = await qboFetchInvoicePdf(undefined, qboId);
      } else {
        return res.status(404).json({ error: 'Invoice has no PDF source stored.' });
      }
    }

    const docRaw = row.invoice_no || row.qbo_doc_number;
    const doc = docRaw ? String(docRaw).replace(/[^\w.-]/g, '_') : '';
    const safeEnr = enrolmentId.replace(/[^\w.-]/g, '_');
    const filename = `Invoice_${doc || qboId || 'QBO'}_${safeEnr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdf.length));
    return res.status(200).send(pdf);
  } catch (e) {
    console.error('[billing/invoice-pdf]', e);
    const msg = e instanceof Error ? e.message : 'Failed to load invoice PDF';
    return res.status(500).json({ error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
