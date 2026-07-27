import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  processCompanyApplication,
  sweepGrantsByCourseRunForApplications,
} from '../../../lib/autoEnrolCompanyApplications';

/**
 * POST /api/admin/ca-run-pipeline
 *
 * Body: { applicationIds: string[] }   (required, at least one id)
 *
 * Runs the four-stage CA pipeline for the given rows:
 *   1. SSG enrolment       — skipped if enrolment_id already present
 *   2. Grant lookup        — per-row narrow search + course-run-wide sweep
 *   3. Google Calendar add — addCaLearnerToCalendar with the per-event lock
 *   4. Auto-invoice        — grant-settled rows only (see guard below)
 *
 * Replaces the separate Sync Grants / Sync Calendar buttons. The invoice
 * sweep mirrors bulkProcessCompanyApplications: generateInvoicesForApplications
 * is internally guarded to bill only rows that are SSG-enroled AND grant-
 * settled (or explicitly grant-ineligible), so a row still awaiting its grant
 * is never invoiced with a wrong amount. The explicit "Generate Invoice" button
 * remains for re-billing / manually clearing stragglers.
 *
 * processCompanyApplication is idempotent at each stage: already-enroled
 * rows skip SSG, already-calendar'd learners short-circuit the patch,
 * already-graunted rows just re-confirm. Safe to re-run.
 *
 * Rows are processed 5 at a time (Promise.all batches) to mirror the
 * upload pipeline. Per-event advisory locks inside addCaLearnerToCalendar
 * prevent the parallel-patch race that originally left learners unticked.
 */
const BATCH_SIZE = 5;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  const uniqueIds: string[] = Array.from(
    new Set(applicationIds.map((x: unknown) => String(x || '').trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid applicationIds provided' });
  }

  try {
    const results: {
      id: string;
      success: boolean;
      finalStatus?: string;
      enrolmentId?: string;
      grantId?: string;
      error?: string;
    }[] = [];

    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async id => {
          try {
            return await processCompanyApplication(id);
          } catch (err) {
            return {
              id,
              success: false,
              finalStatus: 'failed',
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      results.push(...batchResults);
    }

    // Catch externally-applied grants (admins sometimes file via the SSG
    // portal directly) — same wide-net sweep the upload pipeline runs in
    // its polling loop, but a single pass here so the button doesn't hang.
    // Admin can re-click for stragglers.
    try {
      await sweepGrantsByCourseRunForApplications(uniqueIds);
    } catch (err) {
      console.warn('[ca-run-pipeline] grant sweep failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    // Flip per-row status to its terminal value so the View page stops
    // showing the spinner on rows that finished. Mirrors the final UPDATE
    // at the end of bulkProcessCompanyApplications.
    await pool.query(
      `UPDATE public.company_application
          SET auto_enrol_status = CASE
                WHEN enrolment_id IS NULL THEN 'failed'
                WHEN COALESCE(grant_id, '') <> '' OR COALESCE(grant_ineligible, false) = true THEN 'grant_found'
                ELSE 'enroled'
              END,
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND auto_enrol_status = 'pending'`,
      [uniqueIds],
    );

    // Stage 4 — auto-invoice. Mirrors bulkProcessCompanyApplications. The
    // generator is internally guarded (skippedNotEnrolled / skippedAwaitingGrants
    // / skippedAlreadyInvoiced), so it only bills enroled + grant-settled rows
    // and never invoices a row that is still awaiting its grant. Non-fatal: a QB
    // failure must not fail the enrol/grant/calendar work that already succeeded.
    let invoice: {
      generated: number;
      skippedAlreadyInvoiced: number;
      skippedNotEnrolled: number;
      skippedAwaitingGrants: number;
      failed: number;
    } | null = null;
    try {
      const { generateInvoicesForApplications } = await import('../../../lib/quickbooks/createCompanyApplicationInvoice');
      const summary = await generateInvoicesForApplications(uniqueIds);
      invoice = {
        generated: summary.generated,
        skippedAlreadyInvoiced: summary.skippedAlreadyInvoiced,
        skippedNotEnrolled: summary.skippedNotEnrolled,
        skippedAwaitingGrants: summary.skippedAwaitingGrants,
        failed: summary.failed,
      };
      console.log(
        `[ca-run-pipeline] invoice sweep — generated ${summary.generated}, alreadyInvoiced ${summary.skippedAlreadyInvoiced}, notEnrolled ${summary.skippedNotEnrolled}, awaitingGrants ${summary.skippedAwaitingGrants}, failed ${summary.failed}`,
      );
      if (summary.failed > 0) {
        console.warn('[ca-run-pipeline] invoice failures:', summary.errors);
      }
    } catch (err) {
      console.error('[ca-run-pipeline] invoice generation crashed (non-fatal):', err);
    }

    const enroled = results.filter(r => r.enrolmentId).length;
    const granted = results.filter(r => r.grantId).length;
    const failed = results.filter(r => !r.success).length;

    return res.status(200).json({
      success: true,
      processed: results.length,
      enroled,
      granted,
      failed,
      invoice,
      results,
    });
  } catch (err) {
    console.error('❌ ca-run-pipeline error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
