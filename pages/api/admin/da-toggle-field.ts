import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/da-toggle-field
 *
 * Toggles a boolean-like field on a da_application row. Used by the
 * View DA table checkboxes (Enrol, Cal, Inv) for manual overrides.
 *
 * Body: { id: string (da_application.id), field: string, value: boolean }
 *
 * Only whitelisted fields are accepted.
 */

const FIELD_MAP: Record<string, { column: string; trueValue: string; falseValue: string | null }> = {
  enrol: { column: 'enrolment_status', trueValue: 'Confirmed', falseValue: null },
  calendar: { column: 'calendar_added', trueValue: 'true', falseValue: 'false' },
  invoice: { column: 'invoice_id', trueValue: 'MANUAL', falseValue: null },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { id, field, value } = req.body || {};

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id is required' });
  }
  if (!field || !FIELD_MAP[field]) {
    return res.status(400).json({ success: false, error: `Invalid field. Must be one of: ${Object.keys(FIELD_MAP).join(', ')}` });
  }
  if (typeof value !== 'boolean') {
    return res.status(400).json({ success: false, error: 'value must be a boolean' });
  }

  const { column, trueValue, falseValue } = FIELD_MAP[field];

  try {
    const dbValue = value ? trueValue : falseValue;
    await pool.query(
      `UPDATE da_application SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [dbValue, id]
    );
    console.log(`✅ [da-toggle-field] ${field} (${column}) = ${dbValue} for ${id}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ da-toggle-field error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
