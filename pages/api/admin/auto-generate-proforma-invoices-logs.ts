import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureProformaLogTable } from '../../../lib/services/proformaInvoiceService';

/**
 * GET /api/admin/auto-generate-proforma-invoices-logs?limit=500
 *
 * Reads per-enrollment logs produced by the scheduled proforma invoice sweep.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    await ensureProformaLogTable();

    const result = await pool.query(
      `SELECT id, run_id, trigger_source, enrollment_id, enrolment_id, learner_name,
              course_code, course_title, invoice_number, drive_url, status, reason,
              error_message, created_at
       FROM auto_generate_proforma_invoices_log
       WHERE trigger_source = 'scheduled'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto generate proforma invoice logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
