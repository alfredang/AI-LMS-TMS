import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
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
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

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

    return res.status(200).json({
      success: true,
      data: {
        bills: list.rows,
        summary: {
          total: Number(s.total) || 0,
          posted: Number(s.posted) || 0,
          pending: Number(s.pending) || 0,
          failed: Number(s.failed) || 0,
          voided: Number(s.voided) || 0,
          totalAmount: Number(s.total_amount) || 0,
        },
      },
    });
  } catch (err: any) {
    console.error('payroll/bills GET failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
