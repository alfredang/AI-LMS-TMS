import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { estimatedPayout, DEFAULT_PAYOUT_TIERS, PayoutTier } from '@lib/payroll/calculate';
import { requireRole } from '@lib/auth/requireRole';
import { ensureClassDatesColumn } from '@lib/payroll/ensureClassDates';

async function loadTiers(): Promise<PayoutTier[]> {
  try {
    const r = await pool.query(`SELECT payroll_tiers FROM training_provider ORDER BY id LIMIT 1`);
    const v = r.rows[0]?.payroll_tiers;
    if (Array.isArray(v) && v.length > 0) return v as PayoutTier[];
  } catch (e) {
    console.warn('payroll: failed to load tiers, using defaults', e);
  }
  return DEFAULT_PAYOUT_TIERS;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  try {
    const months = Math.max(1, Math.min(24, parseInt((req.query.months as string) || '2')));
    const tiers = await loadTiers();

    // Find every (course_run, trainer) pair for runs whose end_date is within the last N months
    // and not cancelled. Trainer rows come from course_run_trainer junction (canonical).
    const candidatesQuery = `
      SELECT
        cr.id              AS course_run_id,
        cr.course_run_id   AS course_run_code,
        c.title            AS course_title,
        c.course_code      AS course_code,
        c.course_fee       AS course_fee,
        cr.end_date::text  AS end_date,
        crt.trainer_id     AS trainer_id,
        crt.trainer_name   AS trainer_name,
        (SELECT COUNT(*) FROM enrollment e
            WHERE e.course_run_id = cr.id
              AND COALESCE(e.enrolment_status,'') NOT IN ('Withdrawn','Cancelled','Admin Removed')
        )::int             AS num_learners
      FROM course_run cr
      LEFT JOIN course c ON c.id = cr.course_id
      INNER JOIN course_run_trainer crt ON crt.course_run_id = cr.id
      WHERE cr.end_date IS NOT NULL
        AND cr.end_date <= CURRENT_DATE
        AND cr.end_date >= (CURRENT_DATE - ($1 || ' months')::interval)
        AND cr.class_status::text = 'Confirmed'
        AND crt.trainer_id IS NOT NULL
    `;
    const candidates = await pool.query(candidatesQuery, [String(months)]);

    // Materialize on read: insert any (course_run, trainer) pair that doesn't yet have a
    // payout row. Skip classes with no enrolled learners — there is nothing to pay out.
    const toInsert = candidates.rows
      .map((row) => {
        const numLearners = Number(row.num_learners) || 0;
        if (numLearners < 1) return null;
        const courseFee = Number(row.course_fee) || 0;
        const { tier, amount } = estimatedPayout(numLearners, courseFee, tiers);
        return [row.course_run_id, row.trainer_id, numLearners, courseFee, tier?.percent ?? 0, amount];
      })
      .filter((v): v is (string | number)[] => v !== null);

    // One multi-row INSERT per chunk instead of a query per candidate. Chunked so the
    // bound-parameter count stays well under Postgres' 65535 limit (6 cols × 500 = 3000).
    const CHUNK = 500;
    for (let start = 0; start < toInsert.length; start += CHUNK) {
      const batch = toInsert.slice(start, start + CHUNK);
      const valuesSql = batch
        .map((_, k) => {
          const b = k * 6;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
        })
        .join(', ');
      await pool.query(
        `INSERT INTO trainer_payout
            (course_run_id, trainer_id, num_learners, course_fee, tier_percent, estimated_payout)
         VALUES ${valuesSql}
         ON CONFLICT (course_run_id, trainer_id) DO NOTHING`,
        batch.flat()
      );
    }

    // Return all payout rows (joined) for runs in the window
    const listQuery = `
      SELECT
        tp.id,
        tp.course_run_id,
        cr.course_run_id      AS course_run_code,
        c.title               AS course_title,
        c.course_code         AS course_code,
        cr.start_date::text   AS start_date,
        cr.end_date::text     AS end_date,
        tp.trainer_id,
        COALESCE(crt.trainer_name, au.full_name, '') AS trainer_name,
        tp.num_learners,
        tp.course_fee,
        tp.tier_percent,
        tp.estimated_payout,
        tp.actual_payout,
        tp.status,
        tp.payment_date::text AS payment_date,
        tp.remark,
        tp.updated_at
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      LEFT JOIN course c ON c.id = cr.course_id
      LEFT JOIN course_run_trainer crt
             ON crt.course_run_id = tp.course_run_id AND crt.trainer_id = tp.trainer_id
      LEFT JOIN app_user au ON au.id = tp.trainer_id
      WHERE cr.end_date >= (CURRENT_DATE - ($1 || ' months')::interval)
        AND cr.end_date <= CURRENT_DATE
        AND (cr.class_status::text = 'Confirmed' OR tp.status = 'completed')
        AND tp.num_learners > 0
      ORDER BY cr.end_date DESC, c.course_code ASC
    `;
    const list = await pool.query(listQuery, [String(months)]);

    // Year-to-date overview for the summary cards — independent of the selected
    // window (which only filters the table list). Scoped to classes whose end_date
    // falls in the current calendar year (1 Jan onwards), so the cards reflect
    // "this year" rather than all-time. The lower bound is derived from the DB
    // clock (date_trunc('year', CURRENT_DATE)) so it rolls over automatically.
    //  - total_amount  : outstanding owed — estimated payout of all pending classes.
    //  - completed_amount: actual money already paid out (completed classes).
    const overviewQuery = `
      SELECT
        COUNT(*)::int                                                              AS total_classes,
        COALESCE(SUM(tp.estimated_payout) FILTER (WHERE tp.status = 'pending'), 0)::float8 AS pending_amount,
        COUNT(*) FILTER (WHERE tp.status = 'pending')::int                            AS pending_count,
        COUNT(*) FILTER (WHERE tp.status = 'completed')::int                          AS completed_count,
        COALESCE(SUM(tp.actual_payout) FILTER (WHERE tp.status = 'completed'), 0)::float8 AS completed_amount,
        COUNT(*) FILTER (WHERE tp.status = 'cancelled')::int                          AS cancelled_count
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      WHERE cr.end_date >= date_trunc('year', CURRENT_DATE)::date
        -- Match the list's visibility rules so the cards never count a class
        -- that isn't listable (e.g. a run cancelled at the class level, or 0 learners).
        AND (cr.class_status::text = 'Confirmed' OR tp.status = 'completed')
        AND tp.num_learners > 0
    `;
    const ov = (await pool.query(overviewQuery)).rows[0] || {};
    const overview = {
      totalClasses: Number(ov.total_classes) || 0,
      totalAmount: Number(ov.pending_amount) || 0, // outstanding still to be paid
      pendingCount: Number(ov.pending_count) || 0,
      pendingAmount: Number(ov.pending_amount) || 0,
      completedCount: Number(ov.completed_count) || 0,
      completedAmount: Number(ov.completed_amount) || 0,
      cancelledCount: Number(ov.cancelled_count) || 0,
    };

    // --- Non-WSQ (manual) classes ----------------------------------------
    // Hand-entered non-funded classes live in their own table and are merged
    // into the same list, tagged source:'manual'. They are NOT window-filtered
    // (they're intentionally curated and may have no dates), so they always show.
    await ensureClassDatesColumn();
    const manual = await pool.query(`
      SELECT
        id,
        class_title,
        course_code,
        trainer_id,
        trainer_name,
        start_date::text   AS start_date,
        end_date::text     AS end_date,
        class_dates,
        num_learners,
        course_fee,
        tier_percent,
        estimated_payout,
        actual_payout,
        status,
        payment_date::text AS payment_date,
        remark,
        updated_at
      FROM payroll_manual_class
      ORDER BY end_date DESC NULLS LAST, created_at DESC
    `);

    const manualRows = manual.rows.map((m) => ({
      id: m.id,
      source: 'manual' as const,
      course_run_id: m.id, // synthetic per-class key (used by the class filter)
      course_run_code: null,
      course_title: m.class_title,
      course_code: m.course_code,
      start_date: m.start_date,
      end_date: m.end_date,
      class_dates: m.class_dates,
      trainer_id: m.trainer_id,
      trainer_name: m.trainer_name,
      num_learners: m.num_learners,
      course_fee: m.course_fee,
      tier_percent: m.tier_percent,
      estimated_payout: m.estimated_payout,
      actual_payout: m.actual_payout,
      status: m.status,
      payment_date: m.payment_date,
      remark: m.remark,
      updated_at: m.updated_at,
    }));

    // Combined overview: WSQ (YTD) + all non-WSQ classes.
    const mo = (
      await pool.query(`
        SELECT
          COUNT(*)::int                                                              AS total_classes,
          COALESCE(SUM(estimated_payout) FILTER (WHERE status = 'pending'), 0)::float8 AS pending_amount,
          COUNT(*) FILTER (WHERE status = 'pending')::int                            AS pending_count,
          COUNT(*) FILTER (WHERE status = 'completed')::int                          AS completed_count,
          COALESCE(SUM(actual_payout) FILTER (WHERE status = 'completed'), 0)::float8  AS completed_amount,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int                          AS cancelled_count
        FROM payroll_manual_class
      `)
    ).rows[0] || {};

    overview.totalClasses += Number(mo.total_classes) || 0;
    overview.pendingCount += Number(mo.pending_count) || 0;
    overview.pendingAmount += Number(mo.pending_amount) || 0;
    overview.completedCount += Number(mo.completed_count) || 0;
    overview.completedAmount += Number(mo.completed_amount) || 0;
    overview.cancelledCount += Number(mo.cancelled_count) || 0;
    overview.totalAmount = overview.pendingAmount; // outstanding = all pending

    // Merge and order by end_date DESC (undated rows last).
    const wsqRows = list.rows.map((r) => ({ ...r, source: 'wsq' as const }));
    const payouts = [...wsqRows, ...manualRows].sort((a, b) => {
      const ae = a.end_date || '';
      const be = b.end_date || '';
      if (ae && be) return be.localeCompare(ae);
      if (ae) return -1;
      if (be) return 1;
      return 0;
    });

    return res.status(200).json({
      success: true,
      data: { payouts, tiers, overview },
    });
  } catch (err: any) {
    console.error('payroll/payouts GET failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
