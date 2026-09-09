import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { replaceDriveFileContent } from '../../../lib/services/invoiceDriveUpload';
import { readQboInvoiceLifecycle } from '../../../lib/quickbooks/voidCompanyApplicationInvoice';
import { qboFetchInvoicePdf } from '../../../lib/services/qboInvoiceService';

/**
 * GET /api/admin/ca-verify-drive?applicationId=<uuid>&documentType=main|grant&url=<...>&fileId=<...>
 *
 * Probes Google Drive for the invoice PDF tied to a Company Application row,
 * and makes sure the copy you are about to open is the current one.
 *
 * Two jobs, both on the way to opening the file:
 *
 *   1. File gone (404 — deleted or trashed) → clear the stale
 *      `*_drive_file_id` / `*_drive_web_view_link` columns so the table stops
 *      showing a broken "View PDF" link. The next Generate Invoice click
 *      re-fetches from QBO via the self-heal branch.
 *   2. QuickBooks copy is NEWER than ours → re-fetch the PDF and overwrite the
 *      Drive file in place. Finance editing an invoice in QuickBooks used to
 *      leave the LMS showing the version captured at generation time, so the
 *      company held one document and our records showed another. Staleness is
 *      decided by comparing the invoice's LastUpdatedTime in QuickBooks against
 *      the Drive file's own modifiedTime — which is when we wrote it — so no
 *      extra column is needed to track it.
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

/**
 * Pull the PDF again when QuickBooks has moved on since we saved ours.
 *
 * Never fatal: this runs on the way to opening a document, so anything that
 * goes wrong here (QuickBooks slow, Drive unhappy) logs and lets the existing
 * file open. A slightly old PDF beats a dead button.
 *
 * The DocNumber is refreshed alongside it, because that is editable in
 * QuickBooks too and the table would otherwise keep showing the old number.
 */
async function refreshPdfIfQboIsNewer(opts: {
  applicationId: string;
  documentType: CaDocumentType;
  driveFileId: string;
  driveModifiedTime: string | null;
}): Promise<boolean> {
  if (!opts.driveModifiedTime) return false;

  const isGrant = opts.documentType === 'grant';
  const invoiceIdCol = isGrant ? 'grant_invoice_id' : 'invoice_id';
  const docNumberCol = isGrant ? 'grant_invoice_doc_number' : 'invoice_doc_number';

  try {
    const rowRes = await pool.query(
      `SELECT COALESCE(${invoiceIdCol}, '') AS invoice_id,
              COALESCE(${docNumberCol}, '') AS doc_number
         FROM public.company_application
        WHERE id = $1`,
      [opts.applicationId]
    );
    const invoiceId = String(rowRes.rows[0]?.invoice_id || '').trim();
    if (!invoiceId) return false;

    const state = await readQboInvoiceLifecycle(invoiceId);
    if (!state.found || !state.lastUpdatedTime) return false;

    const qboUpdated = new Date(state.lastUpdatedTime).getTime();
    const driveWritten = new Date(opts.driveModifiedTime).getTime();
    if (!Number.isFinite(qboUpdated) || !Number.isFinite(driveWritten)) return false;
    // A second of slack: QuickBooks reports whole seconds, and an edit landing
    // in the same second we uploaded is not worth a re-fetch.
    if (qboUpdated <= driveWritten + 1000) return false;

    const pdf = await qboFetchInvoicePdf(undefined, invoiceId);

    // We are about to overwrite a good file, so make sure what came back is
    // actually a PDF. QuickBooks answering 200 with an empty or truncated body
    // is rare but survivable; replacing a valid invoice with it is not.
    const looksLikePdf = pdf.length > 1024 && pdf.subarray(0, 4).toString('latin1') === '%PDF';
    if (!looksLikePdf) {
      console.warn(
        `[ca-verify-drive] QuickBooks returned ${pdf.length} bytes that are not a PDF for invoice ${invoiceId} — keeping the existing file`
      );
      return false;
    }

    const replaced = await replaceDriveFileContent({ fileId: opts.driveFileId, pdf });

    await pool.query(
      `UPDATE public.company_application
          SET ${docNumberCol} = COALESCE(NULLIF($2, ''), ${docNumberCol}),
              ${isGrant ? 'grant_invoice_drive_web_view_link' : 'invoice_drive_web_view_link'} = $3,
              updated_at = now()
        WHERE id = $1`,
      [opts.applicationId, state.docNumber, replaced.webViewLink]
    );

    console.log(
      `[ca-verify-drive] Refreshed ${opts.documentType} invoice PDF for ${opts.applicationId} — QuickBooks copy was newer`
    );
    return true;
  } catch (err) {
    console.warn(
      '[ca-verify-drive] Freshness check failed (opening the existing PDF):',
      err instanceof Error ? err.message : err
    );
    return false;
  }
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
    const meta = await drive.files.get({
      fileId: resolvedFileId,
      fields: 'id, trashed, modifiedTime',
    });
    if (meta.data?.trashed) {
      throw Object.assign(new Error('trashed'), { code: 404 });
    }

    const refreshed = await refreshPdfIfQboIsNewer({
      applicationId,
      documentType,
      driveFileId: resolvedFileId,
      driveModifiedTime: meta.data?.modifiedTime ? String(meta.data.modifiedTime) : null,
    });

    return res.status(200).json({ valid: true, refreshed });
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
