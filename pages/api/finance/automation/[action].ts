import type { NextApiRequest, NextApiResponse } from 'next';
import { getFinanceAutomationAction } from '../../../../lib/config/financeAutomationActions';
import { resolveFinanceAutomationWebhookUrlFromDb } from '../../../../lib/services/financeAutomationWebhookConfig';
import { refreshGrantsForEnrolments } from '../../../../lib/services/billingSync';
import { triggerN8nWebhook } from '../../../../lib/services/n8nWebhookService';

const MAX_ENROLMENT_BATCH = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actionId = typeof req.query.action === 'string' ? req.query.action : '';
  const def = getFinanceAutomationAction(actionId);
  if (!def) {
    return res.status(404).json({ error: 'Unknown automation action', action: actionId });
  }

  try {
    if (def.kind === 'ssg_grant_refresh') {
      const body = (req.body ?? {}) as { enrolmentIds?: unknown };
      const raw = body.enrolmentIds;
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
        return res.status(400).json({ error: 'Body must include enrolmentIds: string[]' });
      }
      const enrolmentIds = raw as string[];
      if (enrolmentIds.length === 0) {
        return res.status(400).json({ error: 'enrolmentIds must not be empty' });
      }
      if (enrolmentIds.length > MAX_ENROLMENT_BATCH) {
        return res.status(400).json({
          error: `At most ${MAX_ENROLMENT_BATCH} enrolments per request`,
        });
      }

      const ssgApp = (req.headers['x-ssg-app'] as string | undefined)?.trim() || undefined;
      const results = await refreshGrantsForEnrolments(enrolmentIds, ssgApp);
      const okCount = results.filter((r) => r.success).length;
      const failCount = results.length - okCount;

      return res.status(200).json({
        success: failCount === 0,
        action: def.id,
        summary: {
          total: results.length,
          succeeded: okCount,
          failed: failCount,
        },
        results,
      });
    }

    if (def.kind === 'n8n_webhook') {
      const envKey = def.webhookEnvKey;
      if (!envKey) {
        return res.status(500).json({ error: 'Action missing webhookEnvKey' });
      }
      const url = await resolveFinanceAutomationWebhookUrlFromDb(envKey);
      if (!url) {
        return res.status(503).json({
          error: `Webhook not configured. Set it in the automation page (Webhook URL → Save).`,
          action: def.id,
        });
      }

      const method = def.httpMethod ?? 'POST';
      const clientPayload =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const payload =
        method === 'GET' ? undefined : { ...clientPayload, trigger: true as const };

      const startedAt = Date.now();
      const webhookResult = await triggerN8nWebhook(url, { method, body: payload });
      const durationMs = Math.max(0, Date.now() - startedAt);

      if (!webhookResult.ok) {
        return res.status(502).json({
          success: false,
          action: def.id,
          error: webhookResult.error || 'Webhook request failed',
          statusCode: webhookResult.statusCode,
          bodySnippet: webhookResult.bodySnippet,
          durationMs,
        });
      }

      return res.status(200).json({
        success: true,
        action: def.id,
        statusCode: webhookResult.statusCode,
        bodySnippet: webhookResult.bodySnippet,
        durationMs,
      });
    }

    return res.status(501).json({ error: 'Unsupported action kind' });
  } catch (e) {
    console.error('[finance/automation]', actionId, e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
