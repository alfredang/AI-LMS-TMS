import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';

type DaDocumentType = 'main' | 'grant' | 'sfc';

function extractDriveFileId(url: string | null | undefined): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const dMatch = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

function resolveColumns(documentType: DaDocumentType): { fileId: string; webViewLink: string; invoiceId?: string } {
  if (documentType === 'grant') {
    return {
      fileId: 'grant_invoice_drive_file_id',
      webViewLink: 'grant_invoice_drive_web_view_link',
    };
  }
  if (documentType === 'sfc') {
    return {
      fileId: 'sfc_invoice_drive_file_id',
      webViewLink: 'sfc_invoice_drive_web_view_link',
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
  if (!['main', 'grant', 'sfc'].includes(documentTypeRaw)) {
    return res.status(400).json({ valid: false, error: 'documentType is required' });
  }

  const documentType = documentTypeRaw as DaDocumentType;
  const resolvedFileId = fileId || extractDriveFileId(url);
  if (!resolvedFileId) {
    return res.status(200).json({ valid: false });
  }

  try {
    const drive = await getDriveClient();
    await drive.files.get({ fileId: resolvedFileId, fields: 'id' });
    return res.status(200).json({ valid: true });
  } catch (err: any) {
    if (err?.code === 404) {
      const cols = resolveColumns(documentType);
      await pool.query(
        `UPDATE da_application
            SET ${cols.invoiceId ? `${cols.invoiceId} = NULL,` : ''}
                ${cols.fileId} = NULL,
                ${cols.webViewLink} = NULL
          WHERE id = $1`,
        [applicationId]
      );
      console.log(`[da-verify-drive] Cleared dead ${documentType} document for application ${applicationId}`);
      return res.status(200).json({ valid: false });
    }

    console.error('[da-verify-drive] Error checking file:', err?.message || err);
    return res.status(200).json({ valid: true });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
