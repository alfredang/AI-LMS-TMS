import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { enqueueInvoiceJobsFromConsolidatedFinance, getInvoiceJobByEnrolmentId } from '@/lib/services/invoiceJobs';
import pool from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const { rowId, enrolmentId } = req.body as { rowId: number; enrolmentId: string };
    if (!rowId || !String(enrolmentId || '').trim()) {
      return res.status(400).json({ success: false, error: 'rowId and enrolmentId are required' });
    }

    const trimmedEnrolmentId = String(enrolmentId).trim();

    const results = await enqueueInvoiceJobsFromConsolidatedFinance([trimmedEnrolmentId]);
    const enqueueResult = results[0];
    if (!enqueueResult?.ok) {
      return res.status(422).json({ success: false, error: enqueueResult?.reason || 'Failed to enqueue invoice job' });
    }

    // Poll for job completion (max 45s)
    const startMs = Date.now();
    let job = await getInvoiceJobByEnrolmentId(trimmedEnrolmentId);
    while (job && job.status !== 'done' && job.status !== 'failed' && Date.now() - startMs < 45_000) {
      await new Promise((r) => setTimeout(r, 1500));
      job = await getInvoiceJobByEnrolmentId(trimmedEnrolmentId);
    }

    if (!job || job.status !== 'done' || !job.qbo_invoice_id) {
      const err =
        job?.last_error ||
        (job?.status === 'failed' ? 'Invoice generation failed' : 'Invoice generation timed out — check back shortly');
      return res.status(422).json({ success: false, error: err });
    }

    await pool.query(
      `UPDATE public.sfc_import_rows SET
         matched_qbo_invoice_id = $2::varchar,
         matched_qbo_doc_number = $3::varchar,
         match_status = 'ready',
         apply_status = NULL,
         apply_error = NULL
       WHERE id = $1::int AND batch_id = $4::int`,
      [rowId, job.qbo_invoice_id, job.qbo_doc_number ?? null, batchId]
    );

    return res.status(200).json({
      success: true,
      data: { qboInvoiceId: job.qbo_invoice_id, qboDocNumber: job.qbo_doc_number ?? null },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
