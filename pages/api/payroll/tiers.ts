import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import {
  DEFAULT_PAYOUT_TIERS,
  validateTiers,
  PayoutTier,
  estimatedPayout,
} from '@lib/payroll/calculate';
import { invalidatePayrollFlagCache } from '@lib/payroll/featureFlag';
import { requireRole } from '@lib/auth/requireRole';

// Re-derive tier_percent + estimated_payout for every PENDING row, from the new
// tier ladder. Applies to both WSQ payouts (trainer_payout) and non-WSQ classes
// (payroll_manual_class) — tiers govern both. Completed/Cancelled rows are left
// untouched (they reflect what was actually paid). Rows are only written when a
// value actually changes (IS DISTINCT FROM), so the returned count is accurate.
async function recomputePendingForTable(
  client: import('pg').PoolClient,
  table: 'trainer_payout' | 'payroll_manual_class',
  tiers: PayoutTier[]
): Promise<number> {
  const pending = await client.query(
    `SELECT id, num_learners, course_fee FROM ${table} WHERE status = 'pending' FOR UPDATE`
  );
  let updated = 0;
  for (const row of pending.rows) {
    const numLearners = Number(row.num_learners) || 0;
    const courseFee = Number(row.course_fee) || 0;
    const { tier, amount } = estimatedPayout(numLearners, courseFee, tiers);
    const tierPercent = tier?.percent ?? 0;
    const r = await client.query(
      `UPDATE ${table}
          SET tier_percent = $1,
              estimated_payout = $2,
              updated_at = NOW()
        WHERE id = $3
          AND status = 'pending'
          AND (tier_percent IS DISTINCT FROM $1
            OR estimated_payout IS DISTINCT FROM $2)`,
      [tierPercent, amount, row.id]
    );
    updated += r.rowCount || 0;
  }
  return updated;
}

// `table` is a server-defined literal (never user input) — safe to interpolate.
async function recomputePendingPayouts(tiers: PayoutTier[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wsq = await recomputePendingForTable(client, 'trainer_payout', tiers);
    const manual = await recomputePendingForTable(client, 'payroll_manual_class', tiers);
    await client.query('COMMIT');
    return wsq + manual;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  try {
    if (req.method === 'GET') {
      const r = await pool.query(
        `SELECT id, payroll_tiers, payroll_enabled FROM training_provider ORDER BY id LIMIT 1`
      );
      const tiers = (r.rows[0]?.payroll_tiers as PayoutTier[]) || DEFAULT_PAYOUT_TIERS;
      const enabled = !!r.rows[0]?.payroll_enabled;
      return res
        .status(200)
        .json({ success: true, data: { tiers, enabled, providerId: r.rows[0]?.id } });
    }

    if (req.method === 'PUT') {
      const { tiers, enabled } = req.body || {};
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      let normalizedTiers: PayoutTier[] | null = null;

      if (tiers !== undefined) {
        const err = validateTiers(tiers);
        if (err) return res.status(400).json({ success: false, error: err });
        normalizedTiers = (tiers as PayoutTier[]).map((t) => ({
          minPax: Number(t.minPax),
          maxPax: t.maxPax === null || t.maxPax === undefined ? null : Number(t.maxPax),
          percent: Number(t.percent),
        }));
        sets.push(`payroll_tiers = $${i++}::jsonb`);
        params.push(JSON.stringify(normalizedTiers));
      }

      if (enabled !== undefined) {
        sets.push(`payroll_enabled = $${i++}`);
        params.push(!!enabled);
      }

      if (sets.length === 0) {
        return res.status(400).json({ success: false, error: 'no fields to update' });
      }

      await pool.query(
        `UPDATE training_provider SET ${sets.join(', ')}
           WHERE id = (SELECT id FROM training_provider ORDER BY id LIMIT 1)`,
        params
      );

      if (enabled !== undefined) invalidatePayrollFlagCache();

      let recomputed = 0;
      if (normalizedTiers) {
        try {
          recomputed = await recomputePendingPayouts(normalizedTiers);
        } catch (e) {
          console.error('payroll/tiers: recompute pending payouts failed', e);
        }
      }

      const r = await pool.query(
        `SELECT payroll_tiers, payroll_enabled FROM training_provider ORDER BY id LIMIT 1`
      );
      return res.status(200).json({
        success: true,
        data: {
          tiers: r.rows[0].payroll_tiers,
          enabled: !!r.rows[0].payroll_enabled,
          recomputed,
        },
      });
    }

    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (err: any) {
    console.error('payroll/tiers failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
