import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { requirePayrollEnabled } from '@lib/payroll/requireEnabled';
import { ensureTrainerBillTable } from '@lib/payroll/ensureTrainerBillTable';
import { BILL_COLS } from '@lib/payroll/trainerBill';

/**
 * GET /api/payroll/bills
 *
 * Billing invoices raised for confirmed trainer payouts — one per class.
 * Window options mirror the Payout List so the two tabs line up:
 *   ?month=YYYY-MM   a single calendar month of bill dates
 *   ?months=N        the rolling last N months (default 12)
 *   ?all=1           everything ever issued
 *
 * Also returns `qboBaseUrl` — the QuickBooks *web app* host, so the UI can deep
 * link a bill without hardcoding it. Derived from the API host each tenant is
 * configured with (QBO_BASE_URL), so a sandbox realm links into sandbox rather
 * than sending Payroll to a production bill that doesn't exist there.
 */

function qboWebAppBaseUrl(): string {
  const explicit = process.env.QBO_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const api = process.env.QBO_BASE_URL || '';
  return /sandbox/i.test(api) ? 'https://sandbox.qbo.intuit.com' : 'https://qbo.intuit.com';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;
  if (!(await requirePayrollEnabled(res))) return;

  try {
    await ensureTrainerBillTable();

    const all = req.query.all === '1' || req.query.all === 'true';
    const monthParam =
      typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null;
    const months = Math.max(1, Math.min(60, parseInt((req.query.months as string) || '12')));

    let whereSql = 'TRUE';
    const params: any[] = [];
    if (!all) {
      if (monthParam) {
        whereSql = `bill_date >= ($1 || '-01')::date
                    AND bill_date < (($1 || '-01')::date + INTERVAL '1 month')`;
        params.push(monthParam);
      } else {
        whereSql = `bill_date >= (CURRENT_DATE - ($1 || ' months')::interval)`;
        params.push(String(months));
      }
    }

    const list = await pool.query(
      `SELECT ${BILL_COLS} FROM trainer_bill
        WHERE ${whereSql}
        ORDER BY bill_date DESC, bill_no DESC`,
      params
    );

    // Summary spans the same window as the list so the cards and the table
    // always agree. Voided bills are excluded from the money total — the
    // number is retired but nothing is owed on it.
    const sum = await pool.query(
      `SELECT
         -- Excludes voided, matching both total_amount below and the list
         -- itself (the "All" view hides voided bills). Counting them here made
         -- the Bills card disagree with "Showing 1-1 of 1" underneath it.
         COUNT(*) FILTER (WHERE status <> 'voided')::int                      AS total,
         COUNT(*) FILTER (WHERE status = 'posted')::int                       AS posted,
         COUNT(*) FILTER (WHERE status IN ('pending'))::int                   AS pending,
         COUNT(*) FILTER (WHERE status = 'failed')::int                       AS failed,
         COUNT(*) FILTER (WHERE status = 'voided')::int                       AS voided,
         COALESCE(SUM(amount) FILTER (WHERE status <> 'voided'), 0)::float8    AS total_amount
       FROM trainer_bill
      WHERE ${whereSql}`,
      params
    );
    const s = sum.rows[0] || {};

    // Live bills across ALL time, so an empty window can say "there are 24
    // elsewhere" rather than implying none have ever been raised. The tab
    // defaults to the current calendar month, which read as "no bills at all"
    // when the month happened to be empty.
    const allTime = await pool.query(
      `SELECT COUNT(*)::int AS total FROM trainer_bill WHERE status <> 'voided'`
    );

    return res.status(200).json({
      success: true,
      data: {
        bills: list.rows,
        qboBaseUrl: qboWebAppBaseUrl(),
        summary: {
          total: Number(s.total) || 0,
          posted: Number(s.posted) || 0,
          pending: Number(s.pending) || 0,
          failed: Number(s.failed) || 0,
          voided: Number(s.voided) || 0,
          totalAmount: Number(s.total_amount) || 0,
          allTimeTotal: Number(allTime.rows[0]?.total) || 0,
        },
      },
    });
  } catch (err: any) {
    console.error('payroll/bills GET failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
