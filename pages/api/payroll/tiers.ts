import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { DEFAULT_PAYOUT_TIERS, validateTiers, PayoutTier } from '@lib/payroll/calculate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const r = await pool.query(`SELECT id, payroll_tiers FROM training_provider ORDER BY id LIMIT 1`);
      const tiers = (r.rows[0]?.payroll_tiers as PayoutTier[]) || DEFAULT_PAYOUT_TIERS;
      return res.status(200).json({ success: true, data: { tiers, providerId: r.rows[0]?.id } });
    }

    if (req.method === 'PUT') {
      const { tiers } = req.body || {};
      const err = validateTiers(tiers);
      if (err) return res.status(400).json({ success: false, error: err });
      const normalized = (tiers as PayoutTier[]).map(t => ({
        minPax: Number(t.minPax),
        maxPax: t.maxPax === null || t.maxPax === undefined ? null : Number(t.maxPax),
        percent: Number(t.percent),
      }));
      await pool.query(
        `UPDATE training_provider SET payroll_tiers = $1::jsonb WHERE id = (SELECT id FROM training_provider ORDER BY id LIMIT 1)`,
        [JSON.stringify(normalized)]
      );
      return res.status(200).json({ success: true, data: { tiers: normalized } });
    }

    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (err: any) {
    console.error('payroll/tiers failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
