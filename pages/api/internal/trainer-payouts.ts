import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '@lib/db';

/**
 * Read-only bridge for the native apps (TC LMS SG): a trainer's completed payouts,
 * found by sign-in email. Called server-to-server by the storefront's mobile API
 * (ai-mms, MMD_MobileApi), never by a browser, so it is not session-authenticated:
 * it needs `Authorization: Bearer <MOBILE_BRIDGE_SECRET>`. With the secret unset the
 * endpoint answers 503, so it is off unless someone turns it on.
 *
 * NON-WSQ ONLY: the TC LMS apps are the non-WSQ apps, so this returns the
 * hand-entered non-WSQ classes (`payroll_manual_class`) and, from `trainer_payout`,
 * only a class whose course code is a C-prefix (non-WSQ) code. WSQ payouts stay
 * on the trainer's Payout History page in this app.
 */
function secretMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from((header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const secret = process.env.MOBILE_BRIDGE_SECRET;
  if (!secret) return res.status(503).json({ success: false, error: 'Bridge not configured' });
  if (!secretMatches(req.headers['authorization'], secret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ success: false, error: 'email required' });

  try {
    const u = await pool.query(
      `SELECT id FROM app_user
        WHERE lower(email) = $1
          AND (account_status IS NULL OR lower(account_status) = 'active')
        LIMIT 2`,
      [email]
    );
    // Not found, or ambiguous: answer with an empty list rather than guess whose payouts these are.
    if (u.rowCount !== 1) return res.status(200).json({ success: true, data: [] });
    const trainerId: string = u.rows[0].id;

    const r = await pool.query(
      `SELECT * FROM (
         SELECT tp.id::text AS id, c.title AS course_title, c.course_code AS course_code,
                tp.num_learners, tp.actual_payout, tp.payment_date::text AS payment_date,
                cr.start_date::text AS start_date, cr.end_date::text AS end_date,
                tp.updated_at, 'wsq'::text AS source
           FROM trainer_payout tp
           JOIN course_run cr ON cr.id = tp.course_run_id
           LEFT JOIN course c ON c.id = cr.course_id
          WHERE tp.trainer_id = $1 AND tp.status = 'completed'
            AND c.course_code ~* '^C[0-9]'
         UNION ALL
         SELECT mc.id::text, mc.class_title, mc.course_code, mc.num_learners, mc.actual_payout,
                mc.payment_date::text, mc.start_date::text, mc.end_date::text,
                mc.updated_at, 'manual'::text
           FROM payroll_manual_class mc
          WHERE mc.trainer_id = $1 AND mc.status = 'completed'
       ) rows
       ORDER BY payment_date DESC NULLS LAST, updated_at DESC
       LIMIT 500`,
      [trainerId]
    );
    return res.status(200).json({
      success: true,
      data: r.rows.map(({ updated_at, ...row }) => ({ ...row, actual_payout: row.actual_payout == null ? null : Number(row.actual_payout) })),
    });
  } catch (err: any) {
    console.error('internal trainer-payouts failed', err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}
