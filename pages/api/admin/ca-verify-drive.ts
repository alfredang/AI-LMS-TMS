import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';

/**
 * GET /api/admin/ca-verify-drive?applicationId=<uuid>&documentType=main|grant&url=<...>&fileId=<...>
 *
 * Probes Google Drive for the invoice PDF tied to a Company Application row.
 * If the file no longer exists (404 — deleted or trashed), clears the stale
 * `*_drive_file_id` / `*_drive_web_view_link` columns so the table doesn't
 * keep showing a broken "View PDF" link. The next Generate Invoice click for
 * that row will re-fetch from QBO and re-upload via the self-heal branch.
 *
 * Mirrors /api/admin/da-verify-drive — DA wrote the pattern first.
 */
type CaDocumentType = 'main' | 'grant';

function extractDriveFileId(url: string | null | undefined): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const dMatch = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

function resolveColumns(documentType: CaDocumentType): { fileId: string; webViewLink: string; invoiceId?: string } {
  if (documentType === 'grant') {
    return {
      fileId: 'grant_invoice_drive_file_id',
      webViewLink: 'grant_invoice_drive_web_view_link',
    };
  }
  return {
    invoiceId: 'invoice_id',
    fileId: 'invoice_drive_file_id',
    webViewLink: 'invoice_drive_web_view_link',
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ valid: false, error: 'Method not allowed' });
  }

  const applicationId = typeof req.query.applicationId === 'string' ? req.query.applicationId.trim() : '';
  const documentTypeRaw = typeof req.query.documentType === 'string' ? req.query.documentType.trim().toLowerCase() : '';
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId.trim() : '';

  if (!applicationId) {
    return res.status(400).json({ valid: false, error: 'applicationId is required' });
  }
  if (!['main', 'grant'].includes(documentTypeRaw)) {
    return res.status(400).json({ valid: false, error: 'documentType must be "main" or "grant"' });
  }

  const documentType = documentTypeRaw as CaDocumentType;
  const resolvedFileId = fileId || extractDriveFileId(url);
  if (!resolvedFileId) {
    return res.status(200).json({ valid: false });
  }

  try {
    const drive = await getDriveClient();
    const meta = await drive.files.get({ fileId: resolvedFileId, fields: 'id, trashed' });
    if (meta.data?.trashed) {
      throw Object.assign(new Error('trashed'), { code: 404 });
    }
    return res.status(200).json({ valid: true });
  } catch (err: any) {
    if (err?.code === 404) {
      const cols = resolveColumns(documentType);
      await pool.query(
        `UPDATE public.company_application
            SET ${cols.invoiceId ? `${cols.invoiceId} = NULL,` : ''}
                ${cols.fileId} = NULL,
                ${cols.webViewLink} = NULL,
                updated_at = now()
          WHERE id = $1`,
        [applicationId]
      );
      console.log(`[ca-verify-drive] Cleared dead ${documentType} document for application ${applicationId}`);
      return res.status(200).json({ valid: false });
    }

    console.error('[ca-verify-drive] Error checking file:', err?.message || err);
    return res.status(200).json({ valid: true });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
