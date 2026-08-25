import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import {
  DEFAULT_PAYOUT_TIERS,
  validateTiers,
  PayoutTier,
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
  // One statement for the whole table. This used to SELECT ... FOR UPDATE every
  // pending row and then issue an UPDATE per row, holding locks on all of them
  // for the duration — fine at a handful of payouts, linear in round trips at
  // a few thousand. The ladder is passed in as a VALUES list and the arithmetic
  // is the same formula payoutAmount() uses (fee × pax × percent, to cents).
  const values: any[] = [];
  const rowsSql = tiers
    .map((t, k) => {
      const b = k * 3;
      values.push(t.minPax, t.maxPax === null || t.maxPax === undefined ? null : t.maxPax, t.percent);
      return `($${b + 1}::int, $${b + 2}::int, $${b + 3}::numeric)`;
    })
    .join(', ');

  const r = await client.query(
    `WITH ladder (min_pax, max_pax, percent) AS (VALUES ${rowsSql}),
     -- The band a row falls into. LIMIT 1 mirrors findTier(): the first match
     -- wins, so an overlapping ladder behaves the same way here as in TS.
     matched AS (
       SELECT t.id,
              (SELECT l.percent FROM ladder l
                WHERE t.num_learners >= l.min_pax
                  AND (l.max_pax IS NULL OR t.num_learners <= l.max_pax)
                ORDER BY l.min_pax LIMIT 1) AS percent
         FROM ${table} t
        WHERE t.status = 'pending'
     ),
     computed AS (
       SELECT m.id,
              COALESCE(m.percent, 0) AS tier_percent,
              CASE WHEN t.num_learners <= 0 OR t.course_fee <= 0 OR COALESCE(m.percent, 0) <= 0
                   THEN 0
                   ELSE round(t.course_fee * t.num_learners * m.percent) / 100
              END AS estimated_payout
         FROM matched m JOIN ${table} t ON t.id = m.id
     )
     UPDATE ${table} t
        SET tier_percent = c.tier_percent,
            estimated_payout = c.estimated_payout,
            updated_at = NOW()
       FROM computed c
      WHERE t.id = c.id
        AND t.status = 'pending'
        AND (t.tier_percent IS DISTINCT FROM c.tier_percent
          OR t.estimated_payout IS DISTINCT FROM c.estimated_payout)`,
    values
  );
  return r.rowCount || 0;
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

// NOTE: deliberately NOT gated on requirePayrollEnabled — this route owns the
// flag, and gating it would make a switched-off tenant impossible to re-enable.
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
      // `canToggle` comes from the server because the client can't work it out:
      // the Payroll dashboard only renders while the ACTIVE role is Payroll, so
      // an admin browsing it looks exactly like a payroll user. This is the same
      // check the PUT enforces, so the button state can't disagree with it.
      return res.status(200).json({
        success: true,
        data: { tiers, enabled, providerId: r.rows[0]?.id, canToggle: authed.roles.has('admin') },
      });
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
        normalizedTiers = (tiers as PayoutTier[])
          .map((t) => ({
            minPax: Number(t.minPax),
            maxPax: t.maxPax === null || t.maxPax === undefined ? null : Number(t.maxPax),
            percent: Number(t.percent),
          }))
          // Ascending by minPax so findTier()'s "first match in array order" and
          // the recompute's "lowest matching band" always pick the same tier.
          .sort((a, b) => a.minPax - b.minPax);
        sets.push(`payroll_tiers = $${i++}::jsonb`);
        params.push(JSON.stringify(normalizedTiers));
      }

      if (enabled !== undefined) {
        // Admin only. This flag governs whether the Payroll role exists at all
        // for the tenant, so letting a Payroll user flip it means they can
        // switch off their own access — and everyone else's — with one click,
        // then be unable to sign back in to undo it.
        if (!authed.roles.has('admin')) {
          return res.status(403).json({
            success: false,
            error: 'Only an administrator can enable or disable the Payroll role.',
          });
        }
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
