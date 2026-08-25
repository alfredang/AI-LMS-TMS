import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { requirePayrollEnabled } from '@lib/payroll/requireEnabled';

/**
 * GET /api/payroll/trainers
 *
 * The trainer accounts a non-WSQ class can be attributed to, for the picker in
 * the Manual Class dialog.
 *
 * Payroll cannot use /api/admin/trainers: that route is gated to admin /
 * training provider, and it returns names without ids — and the id is the whole
 * point here, since it is what links a class to the trainer's own payout
 * history.
 *
 * Deliberately minimal: id, name, email and whether the trainer is still
 * active. No NRIC, no telephone, no profile detail — this is a picker, and
 * Payroll has no reason to receive a trainer's personal data to fill one in.
 *
 * Inactive trainers are included, sorted last: a class being entered now may
 * well have been taught months ago by somebody who has since left, and that
 * payout still needs to reach the right person.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;
  if (!(await requirePayrollEnabled(res))) return;

  try {
    const r = await pool.query(
      `SELECT au.id,
              au.full_name,
              au.email,
              tp.common_name,
              (tp.status = 'Active' AND au.account_status = 'active') AS is_active
         FROM trainer_profile tp
         JOIN app_user au ON au.id = tp.user_id
        ORDER BY (tp.status = 'Active' AND au.account_status = 'active') DESC,
                 au.full_name`
    );

    return res.status(200).json({
      success: true,
      data: {
        trainers: r.rows.map((t) => ({
          id: t.id,
          full_name: t.full_name,
          email: t.email,
          common_name: t.common_name || null,
          is_active: !!t.is_active,
        })),
      },
    });
  } catch (err: any) {
    console.error('payroll/trainers failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
