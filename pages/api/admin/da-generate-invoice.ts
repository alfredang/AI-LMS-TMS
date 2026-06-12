import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { processDirectApplication } from '../../../lib/autoEnrolDirectApplications';
import { driveFileExists } from '../../../lib/services/invoiceDriveUpload';

/**
 * POST /api/admin/da-generate-invoice
 *
 * Runs the invoice pipeline for each selected application. The learner MUST
 * already be enrolled (real SSG enrolment_id, or enrolment_status = Confirmed)
 * before this endpoint will generate or email anything. Rows that aren't
 * enrolled are returned in `results` as `success: false` with a clear error —
 * the admin must enrol them first (Auto-Enrol button or upload a confirmed
 * Excel) before invoices can be cut.
 *
 *   1. Pre-flight: skip rows with no SSG enrolment_id and not Confirmed
 *   2. Search SSG grants → grant_id (skipped if already exists)
 *   3. Create QuickBooks invoice (main + Grant + SFC), upload PDFs to Drive
 *   4. Email main tax invoice to learner
 */
function isRealSsgEnrolmentId(value: unknown): boolean {
  return /^ENR-/i.test(String(value || '').trim());
}

function extractDriveFileId(url: string | null | undefined): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const dMatch = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return idMatch ? idMatch[1] : null;
}

async function clearStaleLearnerInvoiceJob(enrolmentId: string | null | undefined): Promise<boolean> {
  const ref = String(enrolmentId || '').trim();
  if (!ref) return false;

  const jobRes = await pool.query(
    `SELECT id, drive_file_id, drive_web_view_link
       FROM public.invoice_jobs
      WHERE status = 'done'
        AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [ref]
  );

  const job = jobRes.rows[0];
  if (!job) return false;

  const fileId = String(job.drive_file_id || '').trim() || extractDriveFileId(job.drive_web_view_link);
  if (!fileId) return false;
  if (await driveFileExists(fileId)) return false;

  await pool.query(
    `UPDATE public.invoice_jobs
        SET status = 'failed',
            drive_file_id = NULL,
            drive_web_view_link = NULL,
            last_error = 'Google Drive invoice PDF was deleted or is no longer accessible',
            updated_at = NOW()
      WHERE id = $1`,
    [job.id]
  );

  await pool.query(
    `UPDATE public.da_application
        SET invoice_drive_file_id = NULL,
            invoice_drive_web_view_link = NULL,
            updated_at = NOW()
      WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
    [ref]
  );

  console.log(`[da-generate-invoice] cleared stale learner invoice job for ${ref}`);
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  try {
    const rows = await pool.query(
      `SELECT id, application_id, trainee_name, invoice_id, enrolment_id, enrolment_status
         FROM da_application
        WHERE id = ANY($1::uuid[])
          AND LOWER(COALESCE(application_status, '')) NOT IN ('cancelled', 'rejected', 'failed')`,
      [applicationIds]
    );

    const results: {
      id: string;
      success: boolean;
      invoiceId?: string;
      error?: string;
      warning?: string;
      partial?: boolean;
      skipped?: boolean;
    }[] = [];

    for (const row of rows.rows) {
      const hasRealEnrolment = isRealSsgEnrolmentId(row.enrolment_id);
      const isEnrolConfirmed = String(row.enrolment_status || '').toLowerCase() === 'confirmed';

      if (!hasRealEnrolment && !isEnrolConfirmed) {
        const label = row.application_id || row.trainee_name || row.id;
        const error = `${label} is not enrolled yet. Enrol the learner (Auto-Enrol or upload a confirmed Excel) before generating an invoice.`;
        console.warn(`[da-generate-invoice] skipped ${row.id}: ${error}`);
        results.push({ id: row.id, success: false, skipped: true, error });
        continue;
      }

      // Run the full pipeline: enrol → grant → invoice → email learner.
      let clearedStaleLearnerInvoice = false;
      try {
        clearedStaleLearnerInvoice = await clearStaleLearnerInvoiceJob(row.enrolment_id);
      } catch (verifyErr) {
        console.warn(
          `[da-generate-invoice] learner invoice PDF pre-check skipped for ${row.enrolment_id || row.id}:`,
          verifyErr instanceof Error ? verifyErr.message : verifyErr
        );
      }

      const pipelineResult = await processDirectApplication(row.id, undefined, {
        forceInvoice: true,
        sendInvoiceEmail: true,
      });

      if (pipelineResult.success && pipelineResult.invoiceId) {
        results.push({
          id: row.id,
          success: true,
          invoiceId: pipelineResult.invoiceId,
          partial: clearedStaleLearnerInvoice || undefined,
          warning: clearedStaleLearnerInvoice
            ? 'Existing learner invoice PDF was missing and has been regenerated.'
            : undefined,
        });
      } else if (pipelineResult.invoiceId) {
        const warning =
          pipelineResult.error || `Supplemental invoice issue at: ${pipelineResult.failedStep ?? pipelineResult.finalStatus}`;
        console.warn(`[da-generate-invoice] partial success for ${row.id}: ${warning}`);
        results.push({
          id: row.id,
          success: true,
          partial: true,
          invoiceId: pipelineResult.invoiceId,
          warning,
        });
      } else {
        const error =
          pipelineResult.error || `Pipeline stopped at: ${pipelineResult.failedStep ?? pipelineResult.finalStatus}`;
        console.error(`[da-generate-invoice] failed for ${row.id}: ${error}`);
        results.push({
          id: row.id,
          success: false,
          error,
        });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('❌ da-generate-invoice error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
