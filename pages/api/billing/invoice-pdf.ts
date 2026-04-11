import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { qboFetchInvoicePdf } from '../../../lib/services/qboInvoiceService';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';

/**
 * GET — stream QuickBooks invoice PDF for a learner enrolment (same auth model as /api/billing/history).
 * Prefers the file in Google Drive; falls back to QBO PDF API. No LibreOffice required.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const r = await pool.query(
      `SELECT ij.drive_file_id, ij.qbo_invoice_id, ij.qbo_doc_number, ij.invoice_no
       FROM enrollment e
       INNER JOIN public.invoice_jobs ij
         ON LOWER(TRIM(COALESCE(ij.enrolment_id, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id, '')))
         AND ij.status = 'done'
       WHERE e.user_id = $1::uuid
         AND LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($2::text))
       LIMIT 1`,
      [userId, enrolmentId]
    );

    const row = r.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'No completed invoice found for this enrolment.' });
    }

    const driveFileId = row.drive_file_id ? String(row.drive_file_id).trim() : '';
    const qboId = row.qbo_invoice_id ? String(row.qbo_invoice_id).trim() : '';

    let pdf: Buffer;

    if (driveFileId) {
      const drive = await getDriveClient();
      const fileRes = await drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      pdf = Buffer.from(fileRes.data as ArrayBuffer);
    } else if (qboId) {
      pdf = await qboFetchInvoicePdf(undefined, qboId);
    } else {
      return res.status(404).json({ error: 'Invoice has no PDF source stored.' });
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
