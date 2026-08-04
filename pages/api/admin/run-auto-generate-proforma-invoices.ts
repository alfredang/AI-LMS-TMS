import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../../api/external/auto-generate-proforma-invoices';

/**
 * POST /api/admin/run-auto-generate-proforma-invoices
 * Admin "Run Now" trigger for the Auto Generate Proforma Invoices cron.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await runAutomation();
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('run-auto-generate-proforma-invoices error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
