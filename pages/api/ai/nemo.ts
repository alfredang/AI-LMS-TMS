import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
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

function buildPrompt(user: ChatUserContext, memory: string, conversationHistory: string, customPrompt?: string): string {
  const role = user.role || 'Learner';
  const permissions = getRolePermissions(role);

  const toolList = getToolsForRole(role).map(t => `- ${t.name}: ${t.description}`).join('\n');

  return `You are Nemo, the AI operations assistant for the Tertiary Infotech LMS/TMS platform.

Current user: ${user.name || 'Unknown'} (${user.email || 'no email'})
Role: ${role}
${permissions}

You have access to these tools to query the platform database and perform actions:
${toolList}

Key guidelines:
- Format data in clean, readable tables or bullet points. Be concise and actionable.
- If the data shows issues (e.g. classes without trainers, outstanding claims), proactively highlight them.
- For write operations (assign trainer, enroll learner, etc.), confirm what you'll do before executing.
- After performing actions, briefly summarize what was done.
${memory}${customPrompt ? '\n\n' + customPrompt : ''}

--- CONVERSATION ---
${conversationHistory}`;
}

async function getApiKey(): Promise<string | null> {
  // Try DB first
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
    console.error('Failed to fetch API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

// ─── Handler ────────────────────────────────────────────────────────────────

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

  // Get API key (OAuth token or API key)
  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(200).json({ text: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  // Build conversation history string
  const conversationHistory = rawMessages
    .slice(-10)
    .map((m: IncomingMessage) => {
      const role = m.role === 'model' ? 'Assistant' : m.role === 'user' ? 'User' : 'Assistant';
      const content = (m.content || m.text || '').trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  // Build memory and prompt
  const memory = getMemoryForSystemPrompt();
  const prompt = buildPrompt(currentUser, memory, conversationHistory, customSystemPrompt);

  try {
    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        apiKey,
        allowedTools: [],
        maxTurns: 1,
      },
    })) {
      // Collect text from assistant messages
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            resultText += block.text;
          }
        }
      }
      // Also check for result type
      if (message.type === 'result') {
        if (message.text) resultText = message.text;
      }
    }

    if (!resultText) {
      return res.status(200).json({ text: 'I processed your request but have no response. Please try again.' });
    }

    return res.status(200).json({ text: resultText });
  } catch (error: any) {
    console.error('Nemo error:', error);

    if (error.message?.includes('auth') || error.message?.includes('401') || error.message?.includes('key')) {
      return res.status(200).json({ text: 'Authentication error. Please check the API key in Company Settings > LLM Credentials.' });
    }

    return res.status(200).json({ text: `Sorry, I encountered an error: ${error.message || 'Unknown error'}. Please try again.` });
  }
}
