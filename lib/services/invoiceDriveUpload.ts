import path from 'path';
import { Readable } from 'stream';
import pool from '../db';
import { getDriveClient } from '../google-drive/drive-helpers';

function cleanFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function getInvoicesFolderId(): Promise<string> {
  // Prefer DB-config (Company Settings) but fall back to env / known default.
  const r = await pool.query(
    `SELECT key_value
     FROM training_provider_api
     WHERE key_name = 'GOOGLE_DRIVE_INVOICES_FOLDER_ID'
     LIMIT 1`
  );
  const fromDb = r.rows[0]?.key_value?.trim();
  if (fromDb) return fromDb;

  return (process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID || '1hBhu-Mr9HPUFdjpbZhN1GrwZBTWns_WK').trim();
}

export async function uploadInvoicePdfToDrive(params: {
  pdf: Buffer;
  fileName: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getDriveClient();
  const folderId = await getInvoicesFolderId();

  const safeName = cleanFileName(params.fileName || `invoice_${Date.now()}.pdf`);
  const createResponse = await drive.files.create({
    requestBody: {
      name: safeName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(params.pdf),
    },
    fields: 'id, webViewLink',
  });

  const fileId = createResponse.data.id;
  if (!fileId) throw new Error('Google Drive did not return a file ID for invoice PDF upload');

  // Allow download via our backend; still ok to set "anyone reader" for safety/preview
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    fileId,
    webViewLink: createResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

