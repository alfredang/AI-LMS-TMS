import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/training-provider/toggle-setting
 *
 * Lightweight endpoint that updates a single boolean column on the
 * training_provider table. Used by the admin settings toggles in the
 * Company Settings card so they auto-save on click without requiring
 * the full profile save flow.
 *
 * Body: { column: string, value: boolean }
 *
 * Only whitelisted column names are accepted to prevent SQL injection.
 */

const ALLOWED_COLUMNS = new Set([
  'auto_send_proforma_invoice',
  'auto_send_confirm_email',
  'auto_send_invoice',
  'auto_send_receipt',
  'auto_send_certificate',
  'auto_send_thankyou_email',
  'auto_import_da_from_email',
  'auto_enrol_direct_applications',
  'auto_generate_qb_invoice',
  'auto_add_learner_to_calendar',
  'show_lesson_plan_learner_view',
  'show_certificate_delivery',
  'feedback_form_enabled',
  'auto_mask_sensitive_data',
  'auto_delete_after_six_months',
]);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { column, value } = req.body || {};

  if (typeof column !== 'string' || !ALLOWED_COLUMNS.has(column)) {
    return res.status(400).json({ success: false, error: 'Invalid or disallowed column name' });
  }
  if (typeof value !== 'boolean') {
    return res.status(400).json({ success: false, error: 'value must be a boolean' });
  }

  try {
    await pool.query(
      `UPDATE training_provider SET ${column} = $1, updated_at = NOW()`,
      [value]
    );
    console.log(`✅ [toggle-setting] ${column} = ${value}`);
    return res.status(200).json({ success: true, column, value });
  } catch (err) {
    console.error('❌ toggle-setting error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
