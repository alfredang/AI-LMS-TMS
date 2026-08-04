import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';
import { qboFindInvoiceByDocNumber, qboFetchInvoicePdf } from '@/lib/services/qboInvoiceService';
import { uploadInvoicePdfToDrive } from '@/lib/services/invoiceDriveUpload';

/**
 * POST /api/finance/invoice-jobs/backfill-grn-drive
 *
 * For invoice jobs that have a grn_doc_number (GRN ref) but no grn_drive_web_view_link,
 * fetches the GRN invoice PDF from QuickBooks and uploads it to Google Drive.
 * Named NON-DA_GRANT_QB_invoice_{grnRef}.pdf.
 *
 * Tries both QB apps (app1 then app2) so GRN invoices across multiple QBO companies are found.
 * Called silently on Consolidated Finance page mount, and manually via the Sync GRN PDFs button.
 * Max 10 per call to stay within request timeout.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureInvoiceJobsTable();

    const pending = await pool.query(
      `SELECT id::text AS id, grn_doc_number::text AS grn_doc_number
       FROM public.invoice_jobs
       WHERE grn_doc_number IS NOT NULL
         AND TRIM(grn_doc_number) <> ''
         AND grn_drive_web_view_link IS NULL
       ORDER BY updated_at DESC
       LIMIT 10`
    );

    const rows = pending.rows as Array<{ id: string; grn_doc_number: string }>;
    let resolved = 0;
    let failed = 0;
    const failedRefs: string[] = [];

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
    const apps: string[] = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

    for (const row of rows) {
      try {
        // Try each QB app until the GRN invoice is found
        let grnInvoiceId: string | null = null;
        let foundApp: string | undefined;
        for (const app of apps) {
          const grnInv = await qboFindInvoiceByDocNumber(app, row.grn_doc_number);
          if (grnInv?.id) {
            grnInvoiceId = grnInv.id;
            foundApp = app;
            break;
          }
        }

        if (!grnInvoiceId) {
          console.warn('[backfill-grn-drive] GRN invoice not found in QB for', row.grn_doc_number);
          failed++;
          failedRefs.push(row.grn_doc_number);
          continue;
        }

        const pdf = await qboFetchInvoicePdf(foundApp, grnInvoiceId);
        const fileName = `NON-DA_GRANT_QB_invoice_${row.grn_doc_number}.pdf`;
        const drive = await uploadInvoicePdfToDrive({ pdf, fileName });
        await pool.query(
          `UPDATE public.invoice_jobs
           SET grn_drive_file_id = $2, grn_drive_web_view_link = $3, updated_at = now()
           WHERE id = $1::uuid`,
          [row.id, drive.fileId, drive.webViewLink]
        );
        resolved++;
      } catch (e) {
        console.warn('[backfill-grn-drive] row', row.grn_doc_number, e instanceof Error ? e.message : e);
        failed++;
        failedRefs.push(row.grn_doc_number);
      }
    }

    return res.status(200).json({
      success: true,
      data: { resolved, failed, total: rows.length, failedRefs },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
