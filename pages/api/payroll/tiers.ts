import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { DEFAULT_PAYOUT_TIERS, validateTiers, PayoutTier } from '@lib/payroll/calculate';
import { invalidatePayrollFlagCache } from '@lib/payroll/featureFlag';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

      if (tiers !== undefined) {
        const err = validateTiers(tiers);
        if (err) return res.status(400).json({ success: false, error: err });
        const normalized = (tiers as PayoutTier[]).map((t) => ({
          minPax: Number(t.minPax),
          maxPax: t.maxPax === null || t.maxPax === undefined ? null : Number(t.maxPax),
          percent: Number(t.percent),
        }));
        sets.push(`payroll_tiers = $${i++}::jsonb`);
        params.push(JSON.stringify(normalized));
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

      const r = await pool.query(
        `SELECT payroll_tiers, payroll_enabled FROM training_provider ORDER BY id LIMIT 1`
      );
      return res.status(200).json({
        success: true,
        data: { tiers: r.rows[0].payroll_tiers, enabled: !!r.rows[0].payroll_enabled },
      });
    }

    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (err: any) {
    console.error('payroll/tiers failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
