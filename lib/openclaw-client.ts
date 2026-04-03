import { createHmac } from 'crypto';
import WebSocket from 'ws';
import pool from './db';

const OPENCLAW_URL = process.env.OPENCLAW_GATEWAY_URL;
const OPENCLAW_WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL;
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID;

type OpenClawMode = 'live' | 'local';

interface OpenClawConfig {
  mode: OpenClawMode | null;
  gatewayUrl: string | null;
  localGatewayUrl: string | null;
  hooksPath: string | null;
  agentId: string | null;
  callbackUrl: string | null;
}

interface GatewayFrame {
  type?: string;
  event?: string;
  payload?: any;
  text?: string;
  response?: string;
  message?: string;
  sessionKey?: string;
  ok?: boolean;
  error?: any;
  id?: string;
}

export function buildOpenClawSessionKey(userId: string): string {
  return `hook:lms:user:${userId}`;
}

function normalizeGatewayWsUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function extractText(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('');

  if (typeof value === 'object') {
    const candidates = [
      value.text,
      value.response,
      value.message,
      value.content,
      value.delta,
      value.reply,
      value.result,
      value.payload,
    ];

    for (const candidate of candidates) {
      const text = extractText(candidate);
      if (text) return text;
    }
  }

  return '';
}

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

async function getCompanyOpenClawConfig(userId?: string): Promise<OpenClawConfig> {
  if (!userId) {
    return {
      mode: null,
      gatewayUrl: null,
      localGatewayUrl: null,
      hooksPath: null,
      agentId: null,
      callbackUrl: null,
    };
  }

  try {
    const result = await pool.query(
      `
        SELECT
          tp.openclaw_mode,
          tp.openclaw_gateway_url,
          tp.openclaw_local_gateway_url,
          tp.openclaw_hooks_path,
          tp.openclaw_agent_id,
          tp.openclaw_callback_url
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
      hooksPath: row.openclaw_hooks_path || null,
      agentId: row.openclaw_agent_id || null,
      callbackUrl: row.openclaw_callback_url || null,
    };
  } catch {
    return {
      mode: null,
      gatewayUrl: null,
      localGatewayUrl: null,
      hooksPath: null,
      agentId: null,
      callbackUrl: null,
    };
  }
}

export async function sendToOpenClaw(opts: {
  message: string;
  sessionKey: string;
  name?: string;
  timeoutMs?: number;
  userId?: string;
}): Promise<string> {
  const { message, sessionKey, timeoutMs = 60000, userId } = opts;
  const token = (await getCompanyOpenClawGatewayToken(userId)) || OPENCLAW_GATEWAY_TOKEN;
  const config = await getCompanyOpenClawConfig(userId);
  const configuredBaseUrl = (config.mode === 'local' ? config.localGatewayUrl : config.gatewayUrl) || OPENCLAW_URL;
  const gatewayUrl = OPENCLAW_WS_URL || configuredBaseUrl;
  const agentId = config.agentId || OPENCLAW_AGENT_ID;

  if (!token) {
    throw new Error('OpenClaw gateway token is not configured. Add the OpenClaw Gateway Token in Company Setting or set OPENCLAW_GATEWAY_TOKEN.');
  }

  if (!gatewayUrl) {
    throw new Error('OpenClaw gateway URL is not configured. Add it in Company Setting.');
  }

  const wsUrl = normalizeGatewayWsUrl(gatewayUrl);

  return await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let authenticated = false;
    let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      settle(new Error('Timed out waiting for OpenClaw response'));
    }, timeoutMs);

    const settle = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (error) reject(error);
      else resolve((text || '').trim());
    };

    ws.on('open', () => {
      // wait for challenge frame
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let frame: GatewayFrame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        const nonce = frame.payload?.nonce;
        if (!nonce) {
          return settle(new Error('OpenClaw gateway challenge missing nonce'));
        }

        const signature = createHmac('sha256', token).update(String(nonce)).digest('hex');
        ws.send(
          JSON.stringify({
            type: 'auth',
            payload: { nonce, signature },
          })
        );
        return;
      }

      if (frame.type === 'auth') {
        if (!frame.ok) {
          return settle(new Error(frame.error?.message || frame.error || 'OpenClaw gateway authentication failed'));
        }

        authenticated = true;
        ws.send(
          JSON.stringify({
            type: 'chat.send',
            message,
            sessionKey,
            ...(agentId ? { agentId } : {}),
          })
        );
        return;
      }

      if (frame.type === 'chat.response') {
        const responseText = frame.text || frame.response || extractText(frame.payload || frame);
        return settle(undefined, responseText || '');
      }

      if (frame.type === 'chat.chunk') {
        return;
      }

      if (frame.type === 'error' || frame.ok === false) {
        return settle(new Error(frame.error?.message || frame.error || extractText(frame.payload) || 'OpenClaw gateway request failed'));
      }

      const fallbackText = frame.text || frame.response || extractText(frame.payload || frame);
      if (authenticated && fallbackText && frame.type !== 'event') {
        return settle(undefined, fallbackText);
      }
    });

    ws.on('error', (error) => {
      settle(new Error(`OpenClaw gateway is unreachable at ${configuredBaseUrl || gatewayUrl}. ${(error as Error)?.message || 'Network request failed.'}`));
    });

    ws.on('close', () => {
      if (!settled) {
        settle(new Error('Connection closed unexpectedly'));
      }
    });
  });
}
