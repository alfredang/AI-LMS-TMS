import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { estimatedPayout, DEFAULT_PAYOUT_TIERS, PayoutTier } from '@lib/payroll/calculate';
import { requireRole } from '@lib/auth/requireRole';
import { requirePayrollEnabled } from '@lib/payroll/requireEnabled';
import { ensureClassDatesColumn } from '@lib/payroll/ensureClassDates';
import { ensureTrainerUnlinkedColumn } from '@lib/payroll/ensureTrainerUnlinked';
import { ensureBillNoColumn, BILL_NO_LOCK_NAMESPACE } from '@lib/payroll/billNo';
import { ensurePayoutColumns, EFFECTIVE_END_DATE } from '@lib/payroll/ensurePayoutColumns';
import { ensureTrainerBillTable } from '@lib/payroll/ensureTrainerBillTable';

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
  if (!(await requirePayrollEnabled(res))) return;

  try {
    const months = Math.max(1, Math.min(24, parseInt((req.query.months as string) || '2')));
    // Month mode (?month=YYYY-MM) shows a single calendar month (capped at
    // today), for monthly payroll cycles; otherwise the rolling "last N months".
    const monthParam = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null;
    // Shared end_date window clause. $1 carries either the month string or N.
    // Built over an expression so the same window can be applied to the raw
    // class date (when scanning course_run for new payouts to materialize) or
    // to the payroll-effective date (once a payout row exists and may carry an
    // end_date_override) — a corrected date has to move the row's month too.
    const dateBoundOver = (expr: string) =>
      monthParam
        ? `${expr} >= ($1 || '-01')::date
           AND ${expr} <= LEAST((($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE)`
        : `${expr} <= CURRENT_DATE
           AND ${expr} >= (CURRENT_DATE - ($1 || ' months')::interval)`;
    const dateBoundSql = dateBoundOver('cr.end_date');
    const effectiveDateBoundSql = dateBoundOver(EFFECTIVE_END_DATE);
    const dateBoundParam = monthParam || String(months);
    await ensureBillNoColumn();
    await ensurePayoutColumns();
    // The list joins trainer_bill to expose what each payout was actually
    // billed at; without this the join would fail on a deploy that has not
    // touched the Billing Invoices tab yet.
    await ensureTrainerBillTable();
    // The manual branch selects trainer_unlinked; without this it fails on a
    // deploy whose migration hasn't been applied by hand yet.
    await ensureTrainerUnlinkedColumn();
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
        cr.start_date::text AS start_date,
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
        AND ${dateBoundSql}
        AND cr.class_status::text = 'Confirmed'
        AND crt.trainer_id IS NOT NULL
    `;
    const candidates = await pool.query(candidatesQuery, [dateBoundParam]);

    // Materialize on read: insert any (course_run, trainer) pair that doesn't yet have a
    // payout row. Skip classes with no enrolled learners — there is nothing to pay out.
    const toInsert = candidates.rows
      .map((row) => {
        const numLearners = Number(row.num_learners) || 0;
        if (numLearners < 1) return null;
        const courseFee = Number(row.course_fee) || 0;
        const { tier, amount } = estimatedPayout(numLearners, courseFee, tiers);
        return [
          row.course_run_id,
          row.trainer_id,
          numLearners,
          courseFee,
          tier?.percent ?? 0,
          amount,
          row.start_date, // drives the bill number
        ];
      })
      .filter((v): v is (string | number)[] => v !== null);

    // One multi-row INSERT per chunk instead of a query per candidate. Chunked so the
    // bound-parameter count stays well under Postgres' 65535 limit (7 cols × 500 = 3500).
    //
    // Each new row gets its Bill No here, at creation — every payout is numbered,
    // pending included, the way the legacy spreadsheet was. The ref is built in SQL
    // rather than JS so the whole batch is numbered in one atomic statement:
    // TX<YYMMDD> from the class start date, then a per-day sequence continuing past
    // the highest suffix already used that day (across BOTH payout tables).
    // Rows already present are left untouched by ON CONFLICT DO NOTHING, so a
    // number is never reissued or changed on a later refresh.
    // Serialized under the bill-number advisory lock (key 0 = "all days"): two
    // browser tabs refreshing at once would otherwise number the same fresh rows
    // identically and one INSERT would trip the unique index.
    const insertClient = toInsert.length > 0 ? await pool.connect() : null;
    if (insertClient) await insertClient.query('BEGIN');
    try {
    if (insertClient) {
      await insertClient.query(`SELECT pg_advisory_xact_lock($1, 0)`, [BILL_NO_LOCK_NAMESPACE]);
    }
    const CHUNK = 500;
    for (let start = 0; start < toInsert.length; start += CHUNK) {
      const batch = toInsert.slice(start, start + CHUNK);
      const valuesSql = batch
        .map((_, k) => {
          const b = k * 7;
          return `($${b + 1}::uuid, $${b + 2}::uuid, $${b + 3}::int, $${b + 4}::numeric, $${b + 5}::numeric, $${b + 6}::numeric, $${b + 7}::date)`;
        })
        .join(', ');
      await insertClient!.query(
        `WITH input (course_run_id, trainer_id, num_learners, course_fee, tier_percent, estimated_payout, class_date)
                AS (VALUES ${valuesSql}),
         -- Only rows that don't already have a payout: numbering must not leave
         -- gaps for pairs that are about to be skipped by ON CONFLICT.
         fresh AS (
           SELECT i.* FROM input i
            WHERE NOT EXISTS (
              SELECT 1 FROM trainer_payout t
               WHERE t.course_run_id = i.course_run_id AND t.trainer_id = i.trainer_id
            )
         ),
         used AS (
           SELECT day_prefix, MAX(suffix) AS max_suffix FROM (
             SELECT substring(bill_no FROM 1 FOR 8) AS day_prefix,
                    NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint AS suffix
               FROM trainer_payout WHERE bill_no IS NOT NULL
             UNION ALL
             SELECT substring(bill_no FROM 1 FOR 8),
                    NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint
               FROM payroll_manual_class WHERE bill_no IS NOT NULL
           ) x GROUP BY day_prefix
         )
         INSERT INTO trainer_payout
            (course_run_id, trainer_id, num_learners, course_fee, tier_percent, estimated_payout, bill_no)
         SELECT f.course_run_id, f.trainer_id, f.num_learners, f.course_fee, f.tier_percent, f.estimated_payout,
                CASE WHEN f.class_date IS NULL THEN NULL ELSE
                  'TX' || to_char(f.class_date, 'YYMMDD')
                       || lpad((COALESCE(u.max_suffix, 0)
                                + row_number() OVER (PARTITION BY f.class_date
                                                     ORDER BY f.course_run_id, f.trainer_id))::text, 2, '0')
                END
           FROM fresh f
           LEFT JOIN used u ON u.day_prefix = 'TX' || to_char(f.class_date, 'YYMMDD')
         ON CONFLICT (course_run_id, trainer_id) DO NOTHING`,
        batch.flat()
      );
    }
    if (insertClient) await insertClient.query('COMMIT');
    } catch (e) {
      if (insertClient) await insertClient.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      insertClient?.release();
    }

    // A payout stays visible/payable only while its trainer is STILL assigned to
    // the class (course_run_trainer). Payouts are materialized once and frozen, so
    // without this a trainer removed/reassigned off a class keeps their payout,
    // and the new trainer gets a second one. Gating PENDING payouts on the current
    // assignment makes "reassign the trainer on the class" flow through to payroll
    // automatically — no manual cleanup. Already-paid (completed) rows are kept for
    // the record regardless.
    const stillAssignedSql = `(
      tp.status <> 'pending'
      OR EXISTS (
        SELECT 1 FROM course_run_trainer crt2
         WHERE crt2.course_run_id = tp.course_run_id AND crt2.trainer_id = tp.trainer_id
      )
    )`;

    // Return all payout rows (joined) for runs in the window
    const listQuery = `
      SELECT
        tp.id,
        tp.course_run_id,
        cr.course_run_id      AS course_run_code,
        c.title               AS course_title,
        c.course_code         AS course_code,
        cr.start_date::text   AS start_date,
        ${EFFECTIVE_END_DATE}::text AS end_date,
        cr.end_date::text     AS class_end_date,
        tp.end_date_override::text  AS end_date_override,
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
        tp.bill_no,
        tp.updated_at,
        -- The live billing invoice, if any. At most one row can match: a
        -- partial unique index enforces one non-voided bill per payout.
        tb.amount AS bill_amount,
        tb.status AS bill_status,
        -- Live enrolment count for the class, so the UI can point out a payout
        -- whose pax figure has since gone stale. A payout is materialized once
        -- and then frozen — deliberately, so a paid-out figure can't move under
        -- Payroll — but a learner withdrawing afterwards used to leave the row
        -- quietly out of date with nothing on screen saying so.
        (SELECT COUNT(*) FROM enrollment e
          WHERE e.course_run_id = tp.course_run_id
            AND COALESCE(e.enrolment_status,'') NOT IN ('Withdrawn','Cancelled','Admin Removed')
        )::int AS live_learners
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      LEFT JOIN trainer_bill tb ON tb.payout_id = tp.id AND tb.status <> 'voided'
      LEFT JOIN course c ON c.id = cr.course_id
      LEFT JOIN course_run_trainer crt
             ON crt.course_run_id = tp.course_run_id AND crt.trainer_id = tp.trainer_id
      LEFT JOIN app_user au ON au.id = tp.trainer_id
      WHERE ${effectiveDateBoundSql}
        AND (cr.class_status::text = 'Confirmed' OR tp.status = 'completed')
        AND tp.num_learners > 0
        AND ${stillAssignedSql}
      ORDER BY ${EFFECTIVE_END_DATE} DESC, c.course_code ASC
    `;
    const list = await pool.query(listQuery, [dateBoundParam]);

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
      WHERE ${EFFECTIVE_END_DATE} >= date_trunc('year', CURRENT_DATE)::date
        -- Match the list's visibility rules so the cards never count a class
        -- that isn't listable (e.g. a run cancelled at the class level, or 0 learners,
        -- or a pending payout whose trainer is no longer assigned to the class).
        AND (cr.class_status::text = 'Confirmed' OR tp.status = 'completed')
        AND tp.num_learners > 0
        AND ${stillAssignedSql}
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
    // into the same list, tagged source:'manual'.
    //
    // These are window-filtered on the SAME month/range as the WSQ rows. They
    // used to be returned unconditionally, which meant a June non-WSQ class sat
    // inside the July view and silently inflated that month's trainer totals and
    // the "Selected window" stats.
    //
    // Two deliberate differences from the WSQ window:
    //  1. UNDATED rows (no end_date and no start_date) always show. The table
    //     allows them, and there is no month to file them under — dropping them
    //     would make a hand-entered class invisible in every single view.
    //  2. No CURRENT_DATE upper cap. For WSQ the cap is free (a run that hasn't
    //     ended yet was never materialized into a payout), but a manual row for
    //     an upcoming class already exists, so capping would hide it from its own
    //     month until the date passed.
    const manualDateExpr = `COALESCE(mc.end_date, mc.start_date)`;
    const manualWindowSql = monthParam
      ? `${manualDateExpr} >= ($1 || '-01')::date
         AND ${manualDateExpr} <= (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date`
      : `${manualDateExpr} >= (CURRENT_DATE - ($1 || ' months')::interval)`;
    const manualBoundSql = `(${manualDateExpr} IS NULL OR (${manualWindowSql}))`;

    await ensureClassDatesColumn();
    const manual = await pool.query(
      `
      SELECT
        mc.id,
        mc.class_title,
        mc.course_code,
        mc.trainer_id,
        mc.trainer_unlinked,
        mc.trainer_name,
        mc.start_date::text   AS start_date,
        mc.end_date::text     AS end_date,
        mc.class_dates,
        mc.num_learners,
        mc.course_fee,
        mc.tier_percent,
        mc.estimated_payout,
        mc.actual_payout,
        mc.status,
        mc.payment_date::text AS payment_date,
        mc.remark,
        mc.bill_no,
        mc.updated_at,
        tb.amount AS bill_amount,
        tb.status AS bill_status
      FROM payroll_manual_class mc
      LEFT JOIN trainer_bill tb ON tb.manual_class_id = mc.id AND tb.status <> 'voided'
      WHERE ${manualBoundSql}
      ORDER BY mc.end_date DESC NULLS LAST, mc.created_at DESC
    `,
      [dateBoundParam]
    );

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
      trainer_unlinked: m.trainer_unlinked,
      trainer_name: m.trainer_name,
      num_learners: m.num_learners,
      course_fee: m.course_fee,
      tier_percent: m.tier_percent,
      estimated_payout: m.estimated_payout,
      actual_payout: m.actual_payout,
      status: m.status,
      payment_date: m.payment_date,
      remark: m.remark,
      bill_no: m.bill_no,
      updated_at: m.updated_at,
      bill_amount: m.bill_amount,
      bill_status: m.bill_status,
    }));

    // Combined overview: WSQ (YTD) + non-WSQ, scoped to the SAME year so the two
    // halves of each card are measured the same way. This used to fold in every
    // non-WSQ class ever entered, so the top cards drifted further from the WSQ
    // year-to-date figure with each passing year. Undated rows are kept (they
    // can't be excluded by year, and they are visible in the list).
    const mo = (
      await pool.query(`
        SELECT
          COUNT(*)::int                                                              AS total_classes,
          COALESCE(SUM(estimated_payout) FILTER (WHERE status = 'pending'), 0)::float8 AS pending_amount,
          COUNT(*) FILTER (WHERE status = 'pending')::int                            AS pending_count,
          COUNT(*) FILTER (WHERE status = 'completed')::int                          AS completed_count,
          COALESCE(SUM(actual_payout) FILTER (WHERE status = 'completed'), 0)::float8  AS completed_amount,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int                          AS cancelled_count
        FROM payroll_manual_class mc
        WHERE COALESCE(mc.end_date, mc.start_date) IS NULL
           OR COALESCE(mc.end_date, mc.start_date) >= date_trunc('year', CURRENT_DATE)::date
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
