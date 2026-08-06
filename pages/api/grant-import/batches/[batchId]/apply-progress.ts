import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import pool from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  try {
    await requireFinanceOrAdmin(req);

    const r = await pool.query(
      `SELECT
         b.status::text AS batch_status,
         COUNT(*) FILTER (WHERE r.selected_for_apply = true AND r.match_status = 'ready')::int AS total_selected_ready,
         COUNT(*) FILTER (
           WHERE r.selected_for_apply = true
             AND r.match_status = 'ready'
             AND COALESCE(r.apply_status::text, '') IN ('applied', 'skipped', 'failed')
         )::int AS done_selected_ready,
         COUNT(*) FILTER (WHERE r.apply_status = 'applied')::int AS applied,
         COUNT(*) FILTER (WHERE r.apply_status = 'skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE r.apply_status = 'failed')::int AS failed
       FROM public.grant_import_batches b
       LEFT JOIN public.grant_import_rows r ON r.batch_id = b.id
       WHERE b.id = $1::uuid
       GROUP BY b.status`,
      [batchId]
    );

    return res.status(200).json({ success: true, data: r.rows[0] ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
