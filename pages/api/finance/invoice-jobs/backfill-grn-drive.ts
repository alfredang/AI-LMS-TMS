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
 *   3. GRN invoice missing   → reported in `missingGrn`. Only when the caller explicitly sends
 *                              `{ createMissingGrn: true }` (a Finance user clicking the button)
 *                              is the invoice processor re-run in repair mode for non-DA jobs
 *                              (generated or hand-made), which creates the GRN invoice + PDFs but never a
 *                              new customer invoice. A grant Cancelled in ssg_grants is never
 *                              re-created.
 *
 * Called silently on Consolidated Finance page mount, where it must never create a QuickBooks
 * invoice: a GRN invoice can be missing because Finance deleted it on purpose (e.g. the grant
 * was cancelled on TPG), and page load cannot tell that apart from a failed post-step.
 * Bounded per call; jobs touched in the last 10 minutes are skipped (their own post-steps may
 * still be running) and a failed repair is not retried for 6 hours.
 */
const PDF_LIMIT = 20;
const REPAIR_LIMIT = 3;
const REPAIR_FAILED_PREFIX = 'Document repair failed:';

const g = globalThis as unknown as { __invoiceDocRepairRunning?: boolean };

/**
 * Look the GRN up in every QB company that answers. A company whose connection is broken
 * (e.g. an expired app2 token) is skipped rather than failing the lookup; if none answer,
 * throw — "not found" must only be concluded from a company that actually replied.
 */
async function findGrnInvoice(apps: string[], grnRef: string): Promise<{ id: string; app: string } | null> {
  let answered = 0;
  let lastError: unknown = null;
  for (const app of apps) {
    try {
      const inv = await qboFindInvoiceByDocNumber(app, grnRef);
      answered++;
      if (inv?.id) return { id: inv.id, app };
    } catch (e) {
      lastError = e;
      console.warn(`[backfill-grn-drive] QB ${app} lookup failed for ${grnRef}:`, e instanceof Error ? e.message : e);
    }
  }
  if (answered === 0) throw lastError instanceof Error ? lastError : new Error('QuickBooks unreachable');
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

    const createMissingGrn = req.body?.createMissingGrn === true;
    // Optional: limit the GRN pass to these refs (the rows on the Finance user's current page).
    const grnRefs: string[] | null = Array.isArray(req.body?.grnRefs)
      ? req.body.grnRefs.filter((r: unknown): r is string => typeof r === 'string' && r.trim() !== '').map((r: string) => r.trim().toUpperCase())
      : null;

    let resolved = 0;
    let failed = 0;
    const failedRefs: string[] = [];
    const missingGrn: string[] = [];
    const cancelledGrn: string[] = [];

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
          -- Company group invoices: the company_application row already holds the PDF.
          AND NOT EXISTS (SELECT 1 FROM public.company_application c
                           WHERE TRIM(c.invoice_id::text) = public.invoice_jobs.qbo_invoice_id::text)
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
              -- Generated and hand-made (qb_manual_link) invoices are repaired the same way; DA
              -- (own grant-invoice flow) and company group invoices are not.
              (ij.invoice_no IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.da_application d
                                WHERE UPPER(TRIM(d.enrolment_id)) = UPPER(TRIM(ij.enrolment_id)))
               AND NOT EXISTS (SELECT 1 FROM public.company_application c
                                WHERE TRIM(c.invoice_id::text) = ij.qbo_invoice_id::text)) AS repairable,
              EXISTS (SELECT 1 FROM public.ssg_grants sg
                       WHERE UPPER(TRIM(sg.grant_id)) = UPPER(TRIM(ij.grn_doc_number))
                         AND sg.status = 'Cancelled') AS grant_cancelled
         FROM public.invoice_jobs ij
        WHERE ij.status = 'done'
          AND NULLIF(TRIM(ij.grn_doc_number), '') IS NOT NULL
          AND ij.grn_drive_web_view_link IS NULL
          AND ${settledAndNotBackedOff.replace(/updated_at/g, 'ij.updated_at').replace(/last_error/g, 'ij.last_error')}
          ${grnRefs ? 'AND UPPER(TRIM(ij.grn_doc_number)) = ANY($1::text[])' : ''}
        ORDER BY ij.updated_at DESC
        LIMIT ${PDF_LIMIT}`,
      grnRefs ? [grnRefs] : []
    )).rows as Array<{ id: string; grn_doc_number: string; repairable: boolean; grant_cancelled: boolean }>;

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
        // GRN invoice is not in QB. Never re-create a cancelled grant; otherwise only report it
        // unless a Finance user explicitly asked to create the missing ones.
        if (row.grant_cancelled) {
          cancelledGrn.push(row.grn_doc_number);
          continue;
        }
        if (!createMissingGrn) {
          missingGrn.push(row.grn_doc_number);
          continue;
        }
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
      data: { resolved, failed, total: tcRows.length + grnRows.length, failedRefs, missingGrn, cancelledGrn },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  } finally {
    g.__invoiceDocRepairRunning = false;
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
