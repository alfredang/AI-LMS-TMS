import type { NextApiRequest, NextApiResponse } from 'next';
import { FINANCE_AUTOMATION_ACTIONS } from '../../../../lib/config/financeAutomationActions';

/**
 * Lists registered finance automation actions and whether n8n webhooks are configured (env set).
 * Route is /api/finance/automation/list (not "actions") to avoid clashing with dynamic [action].ts.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actions = FINANCE_AUTOMATION_ACTIONS.map((a) => ({
    id: a.id,
    menuLabel: a.menuLabel,
    kind: a.kind,
    description: a.description,
    configured:
      a.kind === 'n8n_webhook'
        ? Boolean(a.webhookEnvKey && process.env[a.webhookEnvKey])
        : true,
  }));

  return res.status(200).json({ actions });
}
