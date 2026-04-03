import pool from './db';
import { executeTool } from './nemo-tools';

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
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const MAX_TOOL_ROUNDS = 5;

export async function sendToOpenClaw(opts: {
  messages: ChatMessage[];
  tools?: any[];
  timeoutMs?: number;
  userId?: string;
}): Promise<string> {
  const { messages, tools, timeoutMs = 120000, userId } = opts;
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
  const conversationMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let data: any;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: 'openclaw',
          messages: conversationMessages,
          ...(tools && tools.length > 0 ? { tools } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenClaw returned ${response.status}: ${body}`);
      }

      data = await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Timed out waiting for OpenClaw response');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const choice = data?.choices?.[0];
    if (!choice) throw new Error('OpenClaw returned empty response');

    const message = choice.message;

    // If no tool calls, return the final text response
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return (message.content || '').trim();
    }

    // Add assistant message with tool calls to conversation
    conversationMessages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls,
    });

    // Execute each tool call and add results
    for (const toolCall of message.tool_calls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      const result = await executeTool(toolCall.function.name, args);

      conversationMessages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      });
    }
  }

  throw new Error('Max tool calling rounds exceeded');
}
