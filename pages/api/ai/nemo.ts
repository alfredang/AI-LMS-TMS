import type { NextApiRequest, NextApiResponse } from 'next';
import Anthropic from '@anthropic-ai/sdk';
import { getToolsForRole, executeTool } from '../../../lib/nemo-tools';
import { getMemoryForSystemPrompt } from '../../../lib/nemo-memory';
import pool from '../../../lib/db';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatUserContext {
  id: string;
  email?: string;
  role?: string;
  name?: string;
}

interface IncomingMessage {
  role: 'user' | 'assistant' | 'model';
  content?: string;
  text?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRolePermissions(role: string): string {
  switch (role.toUpperCase().replace(/\s+/g, '_')) {
    case 'ADMIN': return 'You have full platform access — courses, classes, trainers, learners, enrollments, finance, SSG operations, and system settings.';
    case 'TRAINING_PROVIDER':
    case 'TRAININGPROVIDER': return 'You are a training provider administrator with access to courses, classes, trainers, enrollments, finance, and SSG operations.';
    case 'FINANCE': return 'You are focused on financial operations — grants, claims, billing, proforma invoices, QuickBooks, and payment tracking.';
    case 'TRAINER': return 'You manage your assigned classes, attendance, assessments, and training hours.';
    case 'DEVELOPER': return 'You manage course content, learning units, and assessments.';
    default: return 'You are a learner with access to your enrolled courses and certificates.';
  }
}

function buildSystemPrompt(user: ChatUserContext, memory: string, customPrompt?: string): string {
  const role = user.role || 'Learner';
  const permissions = getRolePermissions(role);

  return `You are Nemo, the AI operations assistant for the Tertiary Infotech LMS/TMS platform.

You have DIRECT ACCESS to the platform database and APIs through your tools. Use them to answer questions accurately and perform actions when asked.

Key guidelines:
- Format data in clean, readable tables or bullet points. Be concise and actionable.
- If the data shows issues (e.g. classes without trainers, outstanding claims), proactively highlight them.
- For write operations (assign trainer, enroll learner, etc.), confirm what you'll do before executing.
- After performing actions, briefly summarize what was done.
- Use the update_memory tool to save important context for future sessions (sparingly).

Current user: ${user.name || 'Unknown'} (${user.email || 'no email'})
Role: ${role}
${permissions}
${memory}${customPrompt ? '\n\n' + customPrompt : ''}`;
}

function coerceMessages(messages: IncomingMessage[]): Anthropic.MessageParam[] {
  return messages
    .map(m => ({
      role: (m.role === 'model' ? 'assistant' : m.role) as 'user' | 'assistant',
      content: (m.content || m.text || '').trim(),
    }))
    .filter(m => m.content.length > 0);
}

async function getAnthropicApiKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows.length > 0 && result.rows[0].key_value) {
      return result.rows[0].key_value;
    }
  } catch (e) {
    console.error('Failed to fetch Anthropic API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

// ─── Handler ────────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages: rawMessages, currentUser, systemPrompt: customSystemPrompt } = req.body;

  if (!rawMessages || !Array.isArray(rawMessages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  if (!currentUser?.id) {
    return res.status(400).json({ error: 'currentUser.id required' });
  }

  // Get API key
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    return res.status(500).json({ text: 'Anthropic API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  // Build system prompt with memory
  const memory = getMemoryForSystemPrompt();
  const systemPrompt = buildSystemPrompt(currentUser, memory, customSystemPrompt);

  // Get tools for user's role
  const tools = getToolsForRole(currentUser.role || 'Learner');

  // Normalize messages (keep last 10)
  const normalizedMessages = coerceMessages(rawMessages).slice(-10);

  // Ensure messages start with 'user' role (Anthropic requirement)
  if (normalizedMessages.length === 0 || normalizedMessages[0].role !== 'user') {
    normalizedMessages.unshift({ role: 'user', content: 'Hello' });
  }

  try {
    const client = new Anthropic({ apiKey });

    let messages: Anthropic.MessageParam[] = normalizedMessages;
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6-20250527',
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools as any,
        messages,
      });

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use'; id: string; name: string; input: any } =>
          b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls — extract text and return
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');
        return res.status(200).json({ text: text || 'I processed your request but have no additional information to share.' });
      }

      // Execute tools in parallel
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          console.log(`🔧 Nemo executing tool: ${block.name}(${JSON.stringify(block.input)})`);
          const result = await executeTool(block.name, block.input as Record<string, any>);
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: result,
          };
        })
      );

      // Append assistant response and tool results to conversation
      messages = [
        ...messages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];

      iterations++;
    }

    // Max iterations reached
    return res.status(200).json({ text: 'I reached the maximum number of tool calls. Please try a more specific request.' });

  } catch (error: any) {
    console.error('Nemo error:', error);

    // Provide user-friendly error messages
    if (error.status === 401) {
      return res.status(200).json({ text: 'Authentication error. Please check the Anthropic API key in Company Settings > LLM Credentials.' });
    }
    if (error.status === 429) {
      return res.status(200).json({ text: 'Rate limit reached. Please wait a moment and try again.' });
    }

    return res.status(200).json({ text: `Sorry, I encountered an error: ${error.message || 'Unknown error'}. Please try again.` });
  }
}
