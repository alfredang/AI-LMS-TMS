import pool from '../db';

type FinanceWebhookMap = Record<string, unknown>;

function parseMap(raw: unknown): FinanceWebhookMap | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as FinanceWebhookMap;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj === 'object') return obj as FinanceWebhookMap;
  } catch {
    return null;
  }
  return null;
}

/**
 * Loads finance automation webhook URL from training_provider DB.
 * We currently treat this as single-tenant and read the first provider row.
 * (If you later need multi-tenant, pass providerId/userId and resolve provider row first.)
 */
export async function resolveFinanceAutomationWebhookUrlFromDb(
  webhookEnvKey: string
): Promise<string | undefined> {
  try {
    const r = await pool.query(
      `SELECT n8n_finance_webhooks_json FROM training_provider ORDER BY created_at ASC NULLS LAST LIMIT 1`
    );
    const raw = r.rows[0]?.n8n_finance_webhooks_json;
    const map = parseMap(raw);
    const v = map ? map[webhookEnvKey] : undefined;
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    // ignore
  }
  return undefined;
}

export async function upsertFinanceAutomationWebhookUrlInDb(
  webhookEnvKey: string,
  url: string
): Promise<void> {
  // normalize
  const trimmedKey = String(webhookEnvKey || '').trim();
  const trimmedUrl = String(url || '').trim();
  if (!trimmedKey) throw new Error('webhookEnvKey is required');
  if (!trimmedUrl) throw new Error('url is required');

  // Read first provider row (single-tenant assumption).
  const r = await pool.query(
    `SELECT id, n8n_finance_webhooks_json
     FROM training_provider
     ORDER BY created_at ASC NULLS LAST
     LIMIT 1`
  );
  const provider = r.rows[0];
  if (!provider?.id) throw new Error('Training provider not found');

  const current = parseMap(provider.n8n_finance_webhooks_json) || {};
  const next: FinanceWebhookMap = { ...current, [trimmedKey]: trimmedUrl };

  // Ensure the column exists (migration-less pattern used elsewhere in this repo).
  try {
    await pool.query(
      `UPDATE training_provider SET n8n_finance_webhooks_json = $1 WHERE id = $2`,
      [JSON.stringify(next), provider.id]
    );
  } catch (e) {
    // Try to create column then retry.
    await pool.query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS n8n_finance_webhooks_json text`);
    await pool.query(
      `UPDATE training_provider SET n8n_finance_webhooks_json = $1 WHERE id = $2`,
      [JSON.stringify(next), provider.id]
    );
  }
}

