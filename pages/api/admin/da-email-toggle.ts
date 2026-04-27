import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET  /api/admin/da-email-toggle  -> { value: boolean }
 * POST /api/admin/da-email-toggle  body { value: boolean } -> { success, value }
 *
 * Reads/writes `training_provider.auto_send_invoice_email`. This single
 * boolean controls whether the Direct Application invoice pipeline emails
 * the main tax invoice to the learner after generation.
 *
 * Defaults to FALSE so admins can verify invoices are being generated
 * correctly before enabling outbound emails to learners.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT COALESCE(auto_send_invoice_email, false) AS value FROM training_provider LIMIT 1`
      );
      const value = !!result.rows[0]?.value;
      return res.status(200).json({ success: true, value });
    }

    if (req.method === 'POST') {
      const { value } = req.body || {};
      if (typeof value !== 'boolean') {
        return res.status(400).json({ success: false, error: 'value must be a boolean' });
      }
      await pool.query(
        `UPDATE training_provider SET auto_send_invoice_email = $1, updated_at = NOW()`,
        [value]
      );
      console.log(`✅ [da-email-toggle] auto_send_invoice_email = ${value}`);
      return res.status(200).json({ success: true, value });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('❌ da-email-toggle error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
