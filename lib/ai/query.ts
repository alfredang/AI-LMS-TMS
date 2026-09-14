import { CLAUDE_MODEL } from './models';
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk';
import { OPENAI_CREDENTIAL } from './credentials';
import { generateOpenAi } from './settings';

/** Compatibility boundary for existing text/JSON generators; preserves their parsers. */
export async function* query(input: Parameters<typeof claudeQuery>[0]): AsyncGenerator<any> {
  if (input.options?.env?.ANTHROPIC_API_KEY !== OPENAI_CREDENTIAL) {
    yield* claudeQuery({ ...input, options: { ...input.options, model: CLAUDE_MODEL, tools: input.options?.allowedTools || [], settingSources: [] } });
    return;
  }
  if (typeof input.prompt !== 'string') throw new Error('OpenAI generation requires a text prompt.');
  const system = input.options?.systemPrompt;
  if (system && typeof system !== 'string') throw new Error('OpenAI generation requires a text system prompt.');
  const text = await generateOpenAi({ prompt: input.prompt, system,
    webSearch: input.options?.allowedTools?.includes('WebSearch') || false });
  yield { type: 'assistant', message: { content: [{ type: 'text', text }] } };
  yield { type: 'result', result: text };
}
