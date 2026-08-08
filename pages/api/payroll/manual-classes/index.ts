import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import {
  findTier,
  payoutAmount,
  DEFAULT_PAYOUT_TIERS,
  PayoutTier,
} from '@lib/payroll/calculate';
import { requireRole } from '@lib/auth/requireRole';
import { ensureClassDatesColumn } from '@lib/payroll/ensureClassDates';
import { acquireBillNoLock, ensureBillNoColumn, nextBillNo, normalizeBillNo } from '@lib/payroll/billNo';

async function loadTiers(): Promise<PayoutTier[]> {
  try {
    const r = await pool.query(`SELECT payroll_tiers FROM training_provider ORDER BY id LIMIT 1`);
    const v = r.rows[0]?.payroll_tiers;
    if (Array.isArray(v) && v.length > 0) return v as PayoutTier[];
  } catch (e) {
    console.warn('payroll/manual-classes: failed to load tiers, using defaults', e);
  }
  return DEFAULT_PAYOUT_TIERS;
}

const numOrNull = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

// Columns returned to the client. Shared by list + create so the shapes match.
const SELECT_COLS = `
  id, class_title, course_code, trainer_id, trainer_name,
  start_date::text  AS start_date,
  end_date::text    AS end_date,
  class_dates,
  num_learners, course_fee, tier_percent, estimated_payout, actual_payout,
  status,
  payment_date::text AS payment_date,
  remark, bill_no, created_at, updated_at
`;

// Non-consecutive class dates: normalize a "YYYY-MM-DD,YYYY-MM-DD,..." string to
// a sorted unique list, and derive the min/max stored on start_date/end_date.
function normalizeClassDates(raw: any): { classDates: string | null; startDate: string | null; endDate: string | null } {
  if (raw === undefined) return { classDates: undefined as any, startDate: undefined as any, endDate: undefined as any };
  const dates = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const uniq = Array.from(new Set(dates)).sort();
  if (uniq.length === 0) return { classDates: null, startDate: null, endDate: null };
  return { classDates: uniq.join(','), startDate: uniq[0], endDate: uniq[uniq.length - 1] };
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  await ensureClassDatesColumn();
  await ensureBillNoColumn();

  if (req.method === 'GET') {
    try {
      const tiers = await loadTiers();

      const list = await pool.query(
        `SELECT ${SELECT_COLS}
           FROM payroll_manual_class
          ORDER BY end_date DESC NULLS LAST, created_at DESC`
      );

      const ov = (
        await pool.query(`
          SELECT
            COUNT(*)::int                                                                     AS total_classes,
            COALESCE(SUM(estimated_payout) FILTER (WHERE status = 'pending'), 0)::float8       AS pending_amount,
            COUNT(*) FILTER (WHERE status = 'pending')::int                                    AS pending_count,
            COUNT(*) FILTER (WHERE status = 'completed')::int                                  AS completed_count,
            COALESCE(SUM(actual_payout) FILTER (WHERE status = 'completed'), 0)::float8         AS completed_amount,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int                                  AS cancelled_count
          FROM payroll_manual_class
        `)
      ).rows[0] || {};

      const overview = {
        totalClasses: Number(ov.total_classes) || 0,
        totalAmount: Number(ov.pending_amount) || 0, // outstanding still to be paid
        pendingCount: Number(ov.pending_count) || 0,
        pendingAmount: Number(ov.pending_amount) || 0,
        completedCount: Number(ov.completed_count) || 0,
        completedAmount: Number(ov.completed_amount) || 0,
        cancelledCount: Number(ov.cancelled_count) || 0,
      };

      return res.status(200).json({
        success: true,
        data: { classes: list.rows, tiers, overview },
      });
    } catch (err: any) {
      console.error('payroll/manual-classes GET failed', err);
      return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const {
        class_title,
        course_code,
        trainer_id,
        trainer_name,
        start_date,
        end_date,
        class_dates,
        num_learners,
        course_fee,
        tier_percent,
        actual_payout,
        status,
        payment_date,
        remark,
        bill_no,
      } = req.body || {};

      // When an explicit date list is given, it wins and derives start/end.
      const cd = normalizeClassDates(class_dates);
      const hasCd = cd.classDates !== undefined;
      const finalClassDates = hasCd ? cd.classDates : null;
      const finalStart = hasCd ? cd.startDate : (start_date || null);
      const finalEnd = hasCd ? cd.endDate : (end_date || null);

      if (!class_title || !String(class_title).trim()) {
        return res.status(400).json({ success: false, error: 'class_title is required' });
      }
      if (!trainer_name || !String(trainer_name).trim()) {
        return res.status(400).json({ success: false, error: 'trainer_name is required' });
      }
      if (status && !['pending', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ success: false, error: 'invalid status' });
      }

      const learners = Number(numOrNull(num_learners) ?? 0);
      const fee = Number(numOrNull(course_fee) ?? 0);
      let percent = numOrNull(tier_percent);

      for (const [label, v] of [['num_learners', learners], ['course_fee', fee]] as const) {
        if (Number.isNaN(v) || v < 0) {
          return res.status(400).json({ success: false, error: `invalid ${label}` });
        }
      }
      if (percent !== null && (Number.isNaN(percent) || percent < 0 || percent > 100)) {
        return res.status(400).json({ success: false, error: 'tier_percent must be 0-100' });
      }
      const actualVal = numOrNull(actual_payout);
      if (actualVal !== null && (Number.isNaN(actualVal) || actualVal < 0)) {
        return res.status(400).json({ success: false, error: 'actual_payout must be 0 or more' });
      }
      if (start_date && end_date && String(end_date) < String(start_date)) {
        return res.status(400).json({ success: false, error: 'end_date must be on or after start_date' });
      }
      const billNorm = normalizeBillNo(bill_no);
      if (!billNorm.ok) return res.status(400).json({ success: false, error: billNorm.error });

      // If no explicit percent was supplied, derive it from the tier ladder for
      // the given learner count. Same rule the WSQ payouts use.
      if (percent === null) {
        const tiers = await loadTiers();
        percent = findTier(learners, tiers)?.percent ?? 0;
      }

      const estimated = payoutAmount(learners, fee, percent);

      // Transaction so the bill-number read-modify-write is serialized against a
      // concurrent create/mark-as-paid for the same class date.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // An explicit ref wins; otherwise every new class is numbered at creation
        // (pending included) — the whole list carries a Bill No like the legacy
        // spreadsheet did. Classes without dates get one later, when dated.
        let billNo = billNorm.value;
        if (!billNo) {
          await acquireBillNoLock(client, finalStart);
          billNo = await nextBillNo(client, finalStart);
        }

        const r = await client.query(
          `INSERT INTO payroll_manual_class
              (class_title, course_code, trainer_id, trainer_name, start_date, end_date, class_dates,
               num_learners, course_fee, tier_percent, estimated_payout, actual_payout,
               status, payment_date, remark, bill_no, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
           RETURNING ${SELECT_COLS}`,
          [
            String(class_title).trim(),
            course_code ? String(course_code).trim() : null,
            trainer_id || null,
            String(trainer_name).trim(),
            finalStart,
            finalEnd,
            finalClassDates,
            learners,
            fee,
            percent,
            estimated,
            actualVal,
            status || 'pending',
            payment_date || null,
            remark ? String(remark) : null,
            billNo,
            authed.id,
          ]
        );
        await client.query('COMMIT');
        return res.status(201).json({ success: true, data: r.rows[0] });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('payroll/manual-classes POST failed', err);
      if (err?.code === '23505' && String(err?.constraint || '').includes('bill_no')) {
        return res.status(409).json({ success: false, error: 'That Bill No is already used by another payout.' });
      }
      return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
