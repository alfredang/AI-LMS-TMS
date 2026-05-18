import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { qboGetQuickBooksInvoiceEmailFields } from '../../../lib/services/qboInvoiceService';

// Bounded QBO read so the GET handler never hangs when QBO is slow or
// unreachable. Used only by the explicit "Pull from QuickBooks" button —
// the GET handler itself no longer auto-pulls. 8s gives QBO enough time
// to respond on a healthy day while bounding worst-case latency.
const QBO_PULL_TIMEOUT_MS = 8000;
async function qboPullWithTimeout(): Promise<{ cc: string; bcc: string }> {
  return Promise.race([
    qboGetQuickBooksInvoiceEmailFields(undefined),
    new Promise<{ cc: string; bcc: string }>((_, reject) =>
      setTimeout(() => reject(new Error(`QBO pull timed out after ${QBO_PULL_TIMEOUT_MS}ms`)), QBO_PULL_TIMEOUT_MS)
    ),
  ]);
}

/**
 * GET  /api/admin/ca-email-toggle  -> { value, cc, bcc }
 * POST /api/admin/ca-email-toggle  body { value?: boolean, cc?: string, bcc?: string, importFromQuickBooks?: boolean }
 *
 * Reads/writes Company Application invoice email settings:
 * - training_provider.ca_auto_send_invoice_email controls whether the main
 *   tax invoice is emailed to the EMPLOYER contact after Company Application
 *   invoice generation in the upload pipeline.
 * - training_provider.ca_invoice_email_cc / ca_invoice_email_bcc configure
 *   copy recipients without hardcoding addresses in code.
 *
 * Mirrors da-email-toggle.ts. The DA toggle sends to the LEARNER; the CA
 * toggle sends to the EMPLOYER — that's the only behavioural difference.
 */

async function ensureColumns() {
  await pool.query(`
    ALTER TABLE training_provider
      ADD COLUMN IF NOT EXISTS ca_auto_send_invoice_email boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS ca_invoice_email_cc text,
      ADD COLUMN IF NOT EXISTS ca_invoice_email_bcc text
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureColumns();

    if (req.method === 'GET') {
      // No auto-pull from QuickBooks — used to hang ~4 minutes when QBO was
      // slow because every page mount of CaEmailToggleBanner triggers this
      // GET. If the admin wants QBO defaults, they click "Pull from
      // QuickBooks" which POSTs with importFromQuickBooks:true (bounded
      // by qboPullWithTimeout above).
      const result = await pool.query(
        `SELECT
            COALESCE(ca_auto_send_invoice_email, false) AS value,
            ca_invoice_email_cc AS cc,
            ca_invoice_email_bcc AS bcc
         FROM training_provider
         LIMIT 1`
      );

      return res.status(200).json({
        success: true,
        value: !!result.rows[0]?.value,
        cc: result.rows[0]?.cc ?? '',
        bcc: result.rows[0]?.bcc ?? '',
        ccSource: 'company_application',
        bccSource: 'company_application',
      });
    }

    if (req.method === 'POST') {
      const { value, cc, bcc, importFromQuickBooks } = req.body || {};
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({ success: false, error: 'value must be a boolean when provided' });
      }

      if (importFromQuickBooks === true) {
        // Explicit user action — use the bounded pull so a misbehaving QBO
        // can't lock up the UI. Surface the error to the client instead.
        try {
          const qb = await qboPullWithTimeout();
          await pool.query(
            `UPDATE training_provider
             SET ca_invoice_email_cc = $1,
                 ca_invoice_email_bcc = $2,
                 updated_at = NOW()`,
            [qb.cc, qb.bcc]
          );
        } catch (err) {
          return res.status(504).json({
            success: false,
            error: err instanceof Error ? err.message : 'QuickBooks pull failed',
          });
        }
      }

      const shouldUpdateCc = cc !== undefined;
      const shouldUpdateBcc = bcc !== undefined;
      const normalizedCc = shouldUpdateCc ? normalizeRecipientList(cc) : null;
      const normalizedBcc = shouldUpdateBcc ? normalizeRecipientList(bcc) : null;

      if (value !== undefined || shouldUpdateCc || shouldUpdateBcc) {
        await pool.query(
          `UPDATE training_provider
           SET ca_auto_send_invoice_email = COALESCE($1::boolean, ca_auto_send_invoice_email),
               ca_invoice_email_cc = CASE WHEN $2::boolean THEN $3::text ELSE ca_invoice_email_cc END,
               ca_invoice_email_bcc = CASE WHEN $4::boolean THEN $5::text ELSE ca_invoice_email_bcc END,
               updated_at = NOW()`,
          [value, shouldUpdateCc, normalizedCc, shouldUpdateBcc, normalizedBcc]
        );
      }

      const result = await pool.query(
        `SELECT
            COALESCE(ca_auto_send_invoice_email, false) AS value,
            COALESCE(ca_invoice_email_cc, '') AS cc,
            COALESCE(ca_invoice_email_bcc, '') AS bcc
         FROM training_provider
         LIMIT 1`
      );

      console.log(`[ca-email-toggle] ca_auto_send_invoice_email = ${!!result.rows[0]?.value}`);
      return res.status(200).json({
        success: true,
        value: !!result.rows[0]?.value,
        cc: result.rows[0]?.cc || '',
        bcc: result.rows[0]?.bcc || '',
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('ca-email-toggle error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
