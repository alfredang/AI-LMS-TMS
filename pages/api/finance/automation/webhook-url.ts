import type { NextApiRequest, NextApiResponse } from 'next';
import { getFinanceAutomationAction } from '../../../../lib/config/financeAutomationActions';
import {
  resolveFinanceAutomationWebhookUrlFromDb,
  upsertFinanceAutomationWebhookUrlInDb,
} from '../../../../lib/services/financeAutomationWebhookConfig';

function isLikelyHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const actionId = typeof req.query.actionId === 'string' ? req.query.actionId : '';
    const def = getFinanceAutomationAction(actionId);
    if (!def) return res.status(404).json({ error: 'Unknown automation action', action: actionId });
    if (def.kind !== 'n8n_webhook' || !def.webhookEnvKey) {
      return res.status(200).json({ actionId: def.id, kind: def.kind, webhookEnvKey: def.webhookEnvKey ?? null, url: null, source: 'not-applicable' });
    }

    const envKey = def.webhookEnvKey;
    const dbUrl = await resolveFinanceAutomationWebhookUrlFromDb(envKey);
    const url = dbUrl || null;
    const source = dbUrl ? 'db' : 'missing';
    return res.status(200).json({ actionId: def.id, kind: def.kind, webhookEnvKey: envKey, url, source });
  }

  if (req.method === 'PUT') {
    const body = (req.body ?? {}) as { actionId?: unknown; url?: unknown };
    const actionId = typeof body.actionId === 'string' ? body.actionId : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';

    const def = getFinanceAutomationAction(actionId);
    if (!def) return res.status(404).json({ error: 'Unknown automation action', action: actionId });
    if (def.kind !== 'n8n_webhook' || !def.webhookEnvKey) {
      return res.status(400).json({ error: 'This action does not use an n8n webhook URL', action: def.id });
    }
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!isLikelyHttpsUrl(url)) return res.status(400).json({ error: 'url must be a valid https URL' });

    await upsertFinanceAutomationWebhookUrlInDb(def.webhookEnvKey, url);
    return res.status(200).json({ success: true, actionId: def.id, webhookEnvKey: def.webhookEnvKey, url, source: 'db' });
  }

  res.setHeader('Allow', ['GET', 'PUT']);
  return res.status(405).json({ error: 'Method not allowed' });
}

