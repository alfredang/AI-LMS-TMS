import pool from './db';

const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL;
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

async function getCompanyOpenClawGatewayToken(userId?: string): Promise<string | null> {
  if (!userId) return null;

  const result = await pool.query(
    `
      SELECT tpa.key_value
      FROM training_provider_api tpa
      WHERE tpa.training_provider_id = COALESCE(
        (SELECT provider_id FROM training_provider_member WHERE user_id = $1 LIMIT 1),
        (SELECT provider_id FROM provider_admin_user WHERE user_id = $1 LIMIT 1)
      )
      AND tpa.key_name = 'OPENCLAW_GATEWAY_TOKEN'
      AND tpa.key_value IS NOT NULL
      AND tpa.key_value != ''
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.key_value || null;
}

async function getCompanyOpenClawConfig(userId?: string): Promise<{ mode: string | null; gatewayUrl: string | null; localGatewayUrl: string | null }> {
  if (!userId) {
    return { mode: null, gatewayUrl: null, localGatewayUrl: null };
  }

  try {
    const result = await pool.query(
      `
        SELECT
          tp.openclaw_mode,
          tp.openclaw_gateway_url,
          tp.openclaw_local_gateway_url
        FROM training_provider tp
        WHERE tp.id = COALESCE(
          (SELECT provider_id FROM training_provider_member WHERE user_id = $1 LIMIT 1),
          (SELECT provider_id FROM provider_admin_user WHERE user_id = $1 LIMIT 1)
        )
        LIMIT 1
      `,
      [userId]
    );

    const row = result.rows[0] || {};
    return {
      mode: row.openclaw_mode || null,
      gatewayUrl: row.openclaw_gateway_url || null,
      localGatewayUrl: row.openclaw_local_gateway_url || null,
    };
  } catch {
    return { mode: null, gatewayUrl: null, localGatewayUrl: null };
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function sendToOpenClaw(opts: {
  messages: ChatMessage[];
  timeoutMs?: number;
  userId?: string;
}): Promise<string> {
  const { messages, timeoutMs = 120000, userId } = opts;
  const token = (await getCompanyOpenClawGatewayToken(userId)) || OPENCLAW_GATEWAY_TOKEN;
  const config = await getCompanyOpenClawConfig(userId);
  const baseUrl = (config.mode === 'local' ? config.localGatewayUrl : config.gatewayUrl) || OPENCLAW_URL;

  if (!token) {
    throw new Error('OpenClaw gateway token is not configured. Add the OpenClaw Gateway Token in Company Setting or set OPENCLAW_GATEWAY_TOKEN.');
  }

  if (!baseUrl) {
    throw new Error('OpenClaw gateway URL is not configured. Add it in Company Setting.');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[Nemo] Sending ${messages.length} messages to OpenClaw`);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-openclaw-model': 'minimax/MiniMax-M2.7',
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages,
      }),
      signal: controller.signal,
    });

    console.log(`[Nemo] OpenClaw responded ${response.status} in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenClaw returned ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenClaw returned empty response');
    }

    return content.trim();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Timed out waiting for OpenClaw response');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call MiniMax directly via OpenClaw for simple Q&A (no agent overhead).
 * Faster than full OpenClaw agent pipeline (~3-5s vs ~15s).
 */
export async function sendToMiniMaxDirect(opts: {
  messages: ChatMessage[];
  timeoutMs?: number;
  userId?: string;
}): Promise<string> {
  const { messages, timeoutMs = 60000, userId } = opts;
  const token = (await getCompanyOpenClawGatewayToken(userId)) || OPENCLAW_GATEWAY_TOKEN;
  const config = await getCompanyOpenClawConfig(userId);
  const baseUrl = (config.mode === 'local' ? config.localGatewayUrl : config.gatewayUrl) || OPENCLAW_URL;

  if (!token || !baseUrl) {
    // Fall back to full OpenClaw if config missing
    return sendToOpenClaw(opts);
  }

  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[Nemo] Direct MiniMax call with ${messages.length} messages`);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-openclaw-model': 'minimax/MiniMax-M2.7',
        'x-openclaw-bypass-agent': 'true',
      },
      body: JSON.stringify({
        model: 'minimax/MiniMax-M2.7',
        messages,
      }),
      signal: controller.signal,
    });

    console.log(`[Nemo] MiniMax direct responded ${response.status} in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      // Fall back to full OpenClaw on error
      console.log('[Nemo] MiniMax direct failed, falling back to OpenClaw');
      return sendToOpenClaw(opts);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return sendToOpenClaw(opts);

    return content.trim();
  } catch {
    return sendToOpenClaw(opts);
  } finally {
    clearTimeout(timeout);
  }
}
