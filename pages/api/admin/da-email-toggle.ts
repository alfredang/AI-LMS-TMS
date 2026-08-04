import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { qboGetQuickBooksInvoiceEmailFields } from '../../../lib/services/qboInvoiceService';

/**
 * GET  /api/admin/da-email-toggle  -> { value, cc, bcc }
 * POST /api/admin/da-email-toggle  body { value?: boolean, cc?: string, bcc?: string }
 *
 * Reads/writes Direct Application invoice email settings:
 * - training_provider.auto_send_invoice_email controls whether the main tax
 *   invoice is emailed to the learner after generation.
 * - training_provider.da_invoice_email_cc / da_invoice_email_bcc configure
 *   copy recipients without hardcoding addresses in code.
 */

async function ensureColumns() {
  await pool.query(`
    ALTER TABLE training_provider
      ADD COLUMN IF NOT EXISTS auto_send_invoice_email boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS da_invoice_email_cc text,
      ADD COLUMN IF NOT EXISTS da_invoice_email_bcc text
  `);
}

function normalizeRecipientList(value: unknown): string {
  if (typeof value !== 'string') return '';
  const recipients = value
    .split(/[,\n;]/)
    .map(email => email.trim())
    .filter(Boolean);
  return recipients.length ? Array.from(new Set(recipients)).join(', ') : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureColumns();

    if (req.method === 'GET') {
      const result = await pool.query(
        `SELECT
            COALESCE(auto_send_invoice_email, false) AS value,
            da_invoice_email_cc AS cc,
            da_invoice_email_bcc AS bcc
         FROM training_provider
         LIMIT 1`
      );

      const dbCc = result.rows[0]?.cc;
      const dbBcc = result.rows[0]?.bcc;
      let quickBooksCc = '';
      let quickBooksBcc = '';

      if (dbCc === null || dbCc === undefined || dbBcc === null || dbBcc === undefined) {
        try {
          const qb = await qboGetQuickBooksInvoiceEmailFields(undefined);
          quickBooksCc = qb.cc;
          quickBooksBcc = qb.bcc;
        } catch (err) {
          console.warn('[da-email-toggle] Could not pull QuickBooks CC/BCC:', err instanceof Error ? err.message : err);
        }
      }

      return res.status(200).json({
        success: true,
        value: !!result.rows[0]?.value,
        cc: dbCc ?? quickBooksCc,
        bcc: dbBcc ?? quickBooksBcc,
        ccSource: dbCc === null || dbCc === undefined ? 'quickbooks' : 'direct_application',
        bccSource: dbBcc === null || dbBcc === undefined ? 'quickbooks' : 'direct_application',
      });
    }

    if (req.method === 'POST') {
      const { value, cc, bcc, importFromQuickBooks } = req.body || {};
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({ success: false, error: 'value must be a boolean when provided' });
      }

      if (importFromQuickBooks === true) {
        const qb = await qboGetQuickBooksInvoiceEmailFields(undefined);
        await pool.query(
          `UPDATE training_provider
           SET da_invoice_email_cc = $1,
               da_invoice_email_bcc = $2,
               updated_at = NOW()`,
          [qb.cc, qb.bcc]
        );
      }

      const shouldUpdateCc = cc !== undefined;
      const shouldUpdateBcc = bcc !== undefined;
      const normalizedCc = shouldUpdateCc ? normalizeRecipientList(cc) : null;
      const normalizedBcc = shouldUpdateBcc ? normalizeRecipientList(bcc) : null;

      if (value !== undefined || shouldUpdateCc || shouldUpdateBcc) {
        await pool.query(
          `UPDATE training_provider
           SET auto_send_invoice_email = COALESCE($1::boolean, auto_send_invoice_email),
               da_invoice_email_cc = CASE WHEN $2::boolean THEN $3::text ELSE da_invoice_email_cc END,
               da_invoice_email_bcc = CASE WHEN $4::boolean THEN $5::text ELSE da_invoice_email_bcc END,
               updated_at = NOW()`,
          [value, shouldUpdateCc, normalizedCc, shouldUpdateBcc, normalizedBcc]
        );
      }

      const result = await pool.query(
        `SELECT
            COALESCE(auto_send_invoice_email, false) AS value,
            COALESCE(da_invoice_email_cc, '') AS cc,
            COALESCE(da_invoice_email_bcc, '') AS bcc
         FROM training_provider
         LIMIT 1`
      );

      console.log(`[da-email-toggle] auto_send_invoice_email = ${!!result.rows[0]?.value}`);
      return res.status(200).json({
        success: true,
        value: !!result.rows[0]?.value,
        cc: result.rows[0]?.cc || '',
        bcc: result.rows[0]?.bcc || '',
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('da-email-toggle error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
