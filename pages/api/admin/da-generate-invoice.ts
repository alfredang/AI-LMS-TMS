import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { processDirectApplication } from '../../../lib/autoEnrolDirectApplications';

/**
 * POST /api/admin/da-generate-invoice
 *
 * Runs the full pipeline for each selected application:
 *   1. Auto-enrol to SSG → enrolment_id  (skipped if already exists)
 *   2. Search SSG grants → grant_id       (skipped if already exists)
 *   3. Create QuickBooks invoice          (forced regardless of auto_generate_qb_invoice flag)
 */
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
      `SELECT id, invoice_id 
       FROM da_application 
       WHERE id = ANY($1::uuid[])
         AND LOWER(COALESCE(application_status, '')) NOT IN ('cancelled', 'rejected', 'failed')`,
      [applicationIds]
    );

    const results: { id: string; success: boolean; invoiceId?: string; error?: string }[] = [];

    for (const row of rows.rows) {
      // Skip rows that already have an invoice
      if (row.invoice_id && String(row.invoice_id).trim() !== '') {
        results.push({ id: row.id, success: true, invoiceId: row.invoice_id });
        continue;
      }

      // Run the full pipeline: enrol → grant → invoice
      const pipelineResult = await processDirectApplication(row.id, undefined, { forceInvoice: true });

      if (pipelineResult.success && pipelineResult.invoiceId) {
        results.push({ id: row.id, success: true, invoiceId: pipelineResult.invoiceId });
      } else {
        results.push({
          id: row.id,
          success: false,
          error: pipelineResult.error || `Pipeline stopped at: ${pipelineResult.failedStep ?? pipelineResult.finalStatus}`,
        });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('❌ da-generate-invoice error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
