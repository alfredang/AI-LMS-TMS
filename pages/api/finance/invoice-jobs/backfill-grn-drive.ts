import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';
import { qboFindInvoiceByDocNumber, qboFetchInvoicePdf } from '@/lib/services/qboInvoiceService';
import { uploadInvoicePdfToDrive } from '@/lib/services/invoiceDriveUpload';
import { processInvoiceJob } from '@/lib/services/invoiceJobProcessor';

/**
 * POST /api/finance/invoice-jobs/backfill-grn-drive
 *
 * Self-heal for generated invoices whose post-steps did not finish, so every invoiced row on
 * Consolidated Finance ends up with its TC number, GRN number, invoice PDF and GRN PDF:
 *
 *   1. Invoice PDF missing   → fetch the customer invoice PDF from QB, upload to Drive.
 *   2. GRN PDF missing       → find the GRN invoice in QB, upload its PDF.
 *   3. GRN invoice missing   → (non-DA, generated jobs only) re-run the invoice processor in
 *                              repair mode, which creates the GRN invoice + PDFs but never a
 *                              new customer invoice.
 *
 * Called silently on Consolidated Finance page mount. Bounded per call; jobs touched in the
 * last 10 minutes are skipped (their own post-steps may still be running) and a failed
 * repair is not retried for 6 hours.
 */
const PDF_LIMIT = 10;
const REPAIR_LIMIT = 3;
const REPAIR_FAILED_PREFIX = 'Document repair failed:';

const g = globalThis as unknown as { __invoiceDocRepairRunning?: boolean };

async function findGrnInvoice(apps: string[], grnRef: string): Promise<{ id: string; app: string } | null> {
  for (const app of apps) {
    const inv = await qboFindInvoiceByDocNumber(app, grnRef);
    if (inv?.id) return { id: inv.id, app };
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (g.__invoiceDocRepairRunning) {
    return res.status(200).json({ success: true, data: { resolved: 0, failed: 0, total: 0, failedRefs: [], skipped: 'already running' } });
  }
  g.__invoiceDocRepairRunning = true;

  try {
    await ensureInvoiceJobsTable();

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
    const apps: string[] = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

    let resolved = 0;
    let failed = 0;
    const failedRefs: string[] = [];

    const settledAndNotBackedOff = `
      updated_at < now() - interval '10 minutes'
      AND (COALESCE(last_error, '') NOT LIKE '${REPAIR_FAILED_PREFIX}%' OR updated_at < now() - interval '6 hours')`;

    // ── 1. Customer invoice PDF missing ────────────────────────────────────────
    const tcRows = (await pool.query(
      `SELECT id::text AS id, qbo_invoice_id::text AS qbo_invoice_id,
              COALESCE(invoice_no, qbo_doc_number)::text AS doc
         FROM public.invoice_jobs
        WHERE status = 'done' AND qbo_invoice_id IS NOT NULL AND drive_web_view_link IS NULL
          AND invoice_no IS NOT NULL AND ${settledAndNotBackedOff}
        ORDER BY updated_at DESC
        LIMIT ${PDF_LIMIT}`
    )).rows as Array<{ id: string; qbo_invoice_id: string; doc: string }>;

    for (const row of tcRows) {
      try {
        const pdf = await qboFetchInvoicePdf(undefined, row.qbo_invoice_id);
        const drive = await uploadInvoicePdfToDrive({ pdf, fileName: `QB_invoice_${row.doc}.pdf` });
        await pool.query(
          `UPDATE public.invoice_jobs SET drive_file_id = $2, drive_web_view_link = $3, updated_at = now() WHERE id = $1::uuid`,
          [row.id, drive.fileId, drive.webViewLink]
        );
        resolved++;
      } catch (e) {
        console.warn('[backfill-grn-drive] invoice PDF', row.doc, e instanceof Error ? e.message : e);
        failed++;
        failedRefs.push(row.doc);
      }
    }

    // ── 2 + 3. GRN PDF missing (and GRN invoice possibly never created) ─────────
    const grnRows = (await pool.query(
      `SELECT ij.id::text AS id, ij.grn_doc_number::text AS grn_doc_number,
              (ij.invoice_no IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.da_application d
                                WHERE UPPER(TRIM(d.enrolment_id)) = UPPER(TRIM(ij.enrolment_id)))) AS repairable
         FROM public.invoice_jobs ij
        WHERE ij.status = 'done'
          AND NULLIF(TRIM(ij.grn_doc_number), '') IS NOT NULL
          AND ij.grn_drive_web_view_link IS NULL
          AND ${settledAndNotBackedOff.replace(/updated_at/g, 'ij.updated_at').replace(/last_error/g, 'ij.last_error')}
        ORDER BY ij.updated_at DESC
        LIMIT ${PDF_LIMIT}`
    )).rows as Array<{ id: string; grn_doc_number: string; repairable: boolean }>;

    let repairs = 0;
    for (const row of grnRows) {
      try {
        const grn = await findGrnInvoice(apps, row.grn_doc_number);
        if (grn) {
          const pdf = await qboFetchInvoicePdf(grn.app, grn.id);
          const drive = await uploadInvoicePdfToDrive({ pdf, fileName: `NON-DA_GRANT_QB_invoice_${row.grn_doc_number}.pdf` });
          await pool.query(
            `UPDATE public.invoice_jobs SET grn_drive_file_id = $2, grn_drive_web_view_link = $3, updated_at = now() WHERE id = $1::uuid`,
            [row.id, drive.fileId, drive.webViewLink]
          );
          resolved++;
          continue;
        }
        // GRN invoice was never created in QB — finish the job's post-steps.
        if (!row.repairable || repairs >= REPAIR_LIMIT) {
          failed++;
          failedRefs.push(row.grn_doc_number);
          continue;
        }
        repairs++;
        await processInvoiceJob(row.id, { repair: true });
        const after = await pool.query(
          `SELECT grn_drive_web_view_link IS NOT NULL AS ok FROM public.invoice_jobs WHERE id = $1::uuid`,
          [row.id]
        );
        if (!after.rows[0]?.ok) throw new Error('GRN invoice still missing after repair');
        await pool.query(
          `UPDATE public.invoice_jobs SET last_error = NULL WHERE id = $1::uuid AND last_error LIKE $2`,
          [row.id, `${REPAIR_FAILED_PREFIX}%`]
        );
        resolved++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[backfill-grn-drive] GRN', row.grn_doc_number, msg);
        // Back off: a done job keeps its status; only the note + timestamp change.
        await pool.query(
          `UPDATE public.invoice_jobs SET last_error = $2, updated_at = now() WHERE id = $1::uuid AND status = 'done'`,
          [row.id, `${REPAIR_FAILED_PREFIX} ${msg}`.slice(0, 500)]
        );
        failed++;
        failedRefs.push(row.grn_doc_number);
      }
    }

    return res.status(200).json({
      success: true,
      data: { resolved, failed, total: tcRows.length + grnRows.length, failedRefs },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  } finally {
    g.__invoiceDocRepairRunning = false;
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
