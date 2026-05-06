/**
 * Direct Anthropic Messages API wrapper for the slides pipeline.
 *
 * The Claude Agent SDK launches the Claude Code CLI as a subprocess, which
 * is what fails in production (Coolify container) — missing CLI binary,
 * blocked egress, OOM during large generations. The Messages API is plain
 * HTTPS with no subprocess and works everywhere @anthropic-ai/sdk is
 * installed.
 *
 * Auth detection (matches lib/anthropic-auth.ts):
 *   - sk-ant-oat… → OAuth subscription token, sent as Bearer Authorization
 *   - sk-ant-api… → API key, sent as X-Api-Key
 * Both paths reach the SAME /v1/messages endpoint that powers the CP /
 * AP / FG / LG generators (which already work in production).
 *
 * This wrapper is the ONLY way the slides pipeline talks to Claude.
 * Phase 1, Phase 2, and Phase 3 all route through `callClaudeJson` so a
 * single network/auth failure mode applies — easier to diagnose than the
 * Agent SDK's opaque subprocess errors.
 */

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
let _clientToken: string | null = null;

function getClient(token: string): Anthropic {
  if (_client && _clientToken === token) return _client;
  const trimmed = token.trim();
  // Subscription/OAuth tokens use Authorization: Bearer …
  // API keys use X-Api-Key … (the SDK default)
  if (trimmed.startsWith('sk-ant-oat')) {
    _client = new Anthropic({ authToken: trimmed });
  } else {
    _client = new Anthropic({ apiKey: trimmed });
  }
  _clientToken = token;
  return _client;
}

export interface ClaudeCallOpts {
  apiKey: string;
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  // Retry budget for transient errors only (network blip, 429, 529).
  // Default 2 = one retry. Real prompt failures (4xx) don't retry.
  maxRetries?: number;
}

/**
 * Call Claude Messages API and return raw text response.
 * Throws on non-retriable errors. Retries 429/5xx/network up to maxRetries.
 */
export async function callClaudeText(opts: ClaudeCallOpts): Promise<string> {
  const { apiKey, model, system, prompt, maxTokens = 4096, maxRetries = 2 } = opts;
  const client = getClient(apiKey);

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }],
      });
      const textBlocks = resp.content.filter((b: any) => b.type === 'text');
      const text = textBlocks.map((b: any) => b.text).join('');
      if (!text || text.trim().length === 0) {
        throw new Error(`Empty response from Claude (stop_reason=${(resp as any).stop_reason})`);
      }
      return text;
    } catch (e: any) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      const retriable = !status || status === 429 || status === 529 || (status >= 500 && status < 600);
      if (!retriable || attempt === maxRetries) {
        throw e;
      }
      // Backoff: 1s, 3s
      const wait = attempt === 1 ? 1000 : 3000;
      console.warn(`[cw-slides-v3] Messages API attempt ${attempt}/${maxRetries} failed (status=${status || '?'}, retriable=${retriable}, msg=${e?.message?.slice(0, 120)}). Retrying in ${wait}ms.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Extract the first valid JSON object from a Claude text response.
 * Handles fenced code blocks and surrounding prose.
 */
export function extractJson(text: string): any {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const start = trimmed.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

/**
 * Convenience: call Claude and parse JSON from response.
 * Throws if response can't be parsed.
 */
export async function callClaudeJson(opts: ClaudeCallOpts): Promise<any> {
  const text = await callClaudeText(opts);
  const parsed = extractJson(text);
  if (!parsed) {
    throw new Error(`Claude response not valid JSON. First 400 chars: ${text.slice(0, 400)}`);
  }
  return parsed;
}

/**
 * Diagnostic: small ping call. Throws on auth/network failure.
 * Used by orchestrator pre-flight check.
 */
export async function pingClaude(apiKey: string, model: string = 'claude-haiku-4-5-20251001'): Promise<{ ok: boolean; text: string }> {
  const text = await callClaudeText({
    apiKey,
    model,
    prompt: 'Reply with exactly the JSON: {"ok":true}',
    maxTokens: 50,
    maxRetries: 1,
  });
  const ok = /\{[^}]*"ok"\s*:\s*true[^}]*\}/.test(text);
  return { ok, text };
}
