import { CLAUDE_MODEL } from './models';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import type { Generation } from './codex';

export async function runClaude(token: string, input: Generation): Promise<string> {
  const content: any[] = [{ type: 'text', text: input.prompt }];
  for (const image of input.images || []) content.push({ type: 'image', source: { type: 'base64',
    media_type: image.extension === 'jpg' ? 'image/jpeg' : `image/${image.extension}`, data: image.data.toString('base64') } });
  async function* messages(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content } };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180000);
  try {
    let text = '';
    for await (const event of query({ prompt: input.images?.length ? messages() : input.prompt,
      options: { env: buildClaudeEnv(token), systemPrompt: input.system, model: CLAUDE_MODEL,
        tools: input.webSearch ? ['WebSearch'] : [], settingSources: [],
        allowedTools: input.webSearch ? ['WebSearch'] : [], maxTurns: input.webSearch ? 3 : 1, abortController: abort } })) {
      if (event.type === 'assistant') for (const block of event.message.content) if (block.type === 'text') text += block.text;
      if (event.type === 'result' && event.subtype !== 'success') throw new Error('Claude generation failed.');
    }
    if (!text.trim()) throw new Error('Claude returned an empty response.');
    return text;
  } catch { throw new Error('Claude generation failed. Reconnect Claude OAuth on the AI Provider page.'); }
  finally { clearTimeout(timer); }
}
