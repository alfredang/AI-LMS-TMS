/**
 * Resolves n8n webhook URLs for finance automation actions.
 *
 * 1. `process.env[webhookEnvKey]` — typical for local `.env` and Vercel (one var per workflow).
 * 2. `N8N_FINANCE_WEBHOOKS_JSON` — optional single JSON object whose keys are the same
 *    env var names (e.g. `N8N_WEBHOOK_APPEND_CANCELLED_CLASS_TRAINEES`) and values are full URLs.
 *    Useful when you prefer one secret blob in the host UI instead of many variables.
 */
export function resolveFinanceN8nWebhookUrl(webhookEnvKey: string): string | undefined {
  const direct = process.env[webhookEnvKey]?.trim();
  if (direct) return direct;

  const bundle = process.env.N8N_FINANCE_WEBHOOKS_JSON?.trim();
  if (!bundle) return undefined;

  try {
    const obj = JSON.parse(bundle) as Record<string, unknown>;
    const v = obj[webhookEnvKey];
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    // ignore invalid JSON
  }
  return undefined;
}
