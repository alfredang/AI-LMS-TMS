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

/**
 * Folder for trainer billing invoices (Payroll). Separate from the customer
 * invoices folder above — these are payables, and Finance keeps them apart.
 *
 * Resolved the same way as the customer folder: Company Settings first, then
 * env, then the Tertiary default. Other tenants override via either of the
 * first two rather than by changing this default.
 */
export async function getTrainerBillsFolderId(): Promise<string> {
  const r = await pool.query(
    `SELECT key_value
     FROM training_provider_api
     WHERE key_name = 'GOOGLE_DRIVE_TRAINER_BILLS_FOLDER_ID'
     LIMIT 1`
  );
  const fromDb = r.rows[0]?.key_value?.trim();
  if (fromDb) return fromDb;

  return (process.env.GOOGLE_DRIVE_TRAINER_BILLS_FOLDER_ID || '1HKveQq8thHD-QAYYAltt1fE-L3ogk3dB').trim();
}

/**
 * Returns true if the given Drive file id resolves to a readable file.
 * Used to detect stale `*_drive_file_id` values (file was deleted / moved /
 * trashed in Drive since we last uploaded) so we can re-upload instead of
 * leaving broken links in the DB.
 */
export async function driveFileExists(fileId: string | null | undefined): Promise<boolean> {
  const id = String(fileId || '').trim();
  if (!id) return false;
  try {
    const drive = await getDriveClient();
    const res = await drive.files.get({ fileId: id, fields: 'id, trashed' });
    if (!res.data?.id) return false;
    if (res.data.trashed === true) return false;
    return true;
  } catch (err: any) {
    // 404 = file was deleted or never existed; anything else we propagate.
    const status = err?.code || err?.response?.status;
    if (status === 404) return false;
    throw err;
  }
}

/**
 * Move a Drive file to the bin. Used when the document it represents is
 * withdrawn — a trainer bill whose payout was un-confirmed, or a CA invoice
 * deleted so the application can be re-invoiced — so Drive stops serving a PDF
 * for something that no longer exists.
 *
 * Trashed rather than hard-deleted: recoverable for 30 days if the removal was
 * a mistake. Returns false instead of throwing when the file is already gone,
 * so callers can treat cleanup as best-effort.
 */
export async function trashDriveFile(fileId: string | null | undefined): Promise<boolean> {
  const id = String(fileId || '').trim();
  if (!id) return false;
  try {
    const drive = await getDriveClient();
    await drive.files.update({ fileId: id, requestBody: { trashed: true } });
    return true;
  } catch (err: any) {
    const status = err?.code || err?.response?.status;
    if (status === 404) return false;
    console.warn('[invoiceDriveUpload] could not trash file', id, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function uploadInvoicePdfToDrive(params: {
  pdf: Buffer;
  fileName: string;
  /** Target folder. Defaults to the customer invoices folder. */
  folderId?: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getDriveClient();
  const folderId = params.folderId?.trim() || (await getInvoicesFolderId());

  const safeName = cleanFileName(params.fileName || `invoice_${Date.now()}.pdf`);

  // Name-based dedup: before uploading, see if a non-trashed file with the
  // same name already lives in the invoices folder. This handles the case
  // where generateInvoicesForApplications self-heals a stale
  // invoice_drive_file_id by re-uploading — without this check, we'd create
  // a second physical PDF with the same name and admins would see two
  // identical rows in Drive (one of the actual prod bugs reported). Drive
  // happily allows duplicate filenames in the same folder; we have to dedup
  // at the application layer.
  //
  // Escape single quotes per the Drive query language. Filename is mostly
  // alphanumerics + `_-.` after cleanFileName so a stray apostrophe is
  // unlikely, but defensive.
  const escapedName = safeName.replace(/'/g, "\\'");
  try {
    const existing = await drive.files.list({
      q: `name = '${escapedName}' and '${folderId}' in parents and trashed = false`,
      fields: 'files(id, webViewLink)',
      pageSize: 1,
    });
    const hit = existing.data.files?.[0];
    if (hit?.id) {
      return {
        fileId: hit.id,
        webViewLink: hit.webViewLink || `https://drive.google.com/file/d/${hit.id}/view`,
      };
    }
  } catch (err) {
    // Dedup is best-effort. If the lookup fails (network, permissions),
    // fall through and create — risk of one duplicate is better than
    // failing the whole pipeline because we couldn't list.
    console.warn('[invoiceDriveUpload] name-dedup lookup failed, proceeding to create:', err instanceof Error ? err.message : err);
  }

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

