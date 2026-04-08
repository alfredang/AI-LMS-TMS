import type { NextApiRequest, NextApiResponse } from 'next';
import { FINANCE_AUTOMATION_ACTIONS } from '../../../../lib/config/financeAutomationActions';
import { resolveFinanceAutomationWebhookUrlFromDb } from '../../../../lib/services/financeAutomationWebhookConfig';

/**
 * Lists registered finance automation actions and whether n8n webhooks are configured (env set).
 * Route is /api/finance/automation/list (not "actions") to avoid clashing with dynamic [action].ts.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  (async () => {
    const actions = await Promise.all(
      FINANCE_AUTOMATION_ACTIONS.map(async (a) => {
        const webhookEnvKey = a.kind === 'n8n_webhook' ? a.webhookEnvKey : undefined;
        const dbUrl = webhookEnvKey ? await resolveFinanceAutomationWebhookUrlFromDb(webhookEnvKey) : undefined;
        const configured = a.kind === 'n8n_webhook' ? Boolean(webhookEnvKey && dbUrl) : true;
        return {
          id: a.id,
          menuLabel: a.menuLabel,
          kind: a.kind,
          description: a.description,
          webhookEnvKey,
          configured,
          // helps admins debug source in production
          source: a.kind === 'n8n_webhook' ? (dbUrl ? 'db' : 'missing') : 'built-in',
        };
      })
    );

    return res.status(200).json({ actions });
  })().catch((e) => {
    console.error('[finance/automation/list] failed:', e);
    return res.status(200).json({ actions: [] });
  });
}
