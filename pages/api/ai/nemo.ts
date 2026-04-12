import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getMemoryForSystemPrompt } from '../../../lib/nemo-memory';
import pool from '../../../lib/db';

// Extend API route timeout for agent SDK
export const config = { maxDuration: 120 };

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatUserContext {
  id: string;
  email?: string;
  role?: string;
  name?: string;
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

Current user: ${user.name || 'Unknown'} (${user.email || 'no email'})
Role: ${role}
${permissions}

Key guidelines:
- Format data in clean, readable tables or bullet points. Be concise and actionable.
- If asked about courses, trainers, classes, enrollments, grants, or claims — provide helpful guidance based on the platform.
- For write operations (assign trainer, enroll learner, etc.), explain what you would do.
- Be proactive in suggesting next steps.
${memory}${customPrompt ? '\n\n' + customPrompt : ''}`;
}

async function getApiKey(): Promise<string | null> {
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

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(200).json({ text: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  // Build conversation as prompt text
  const conversationHistory = rawMessages
    .slice(-10)
    .map((m: any) => {
      const role = m.role === 'model' ? 'Assistant' : m.role === 'user' ? 'User' : 'Assistant';
      const content = (m.content || m.text || '').trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const memory = getMemoryForSystemPrompt();
  const systemPrompt = buildSystemPrompt(currentUser, memory, customSystemPrompt);

  try {
    let resultText = '';

    for await (const message of query({
      prompt: conversationHistory,
      options: {
        apiKey,
        systemPrompt,
        maxTurns: 3,
        allowedTools: [],
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        cwd: process.cwd(),
        env: { ANTHROPIC_API_KEY: apiKey },
      },
    })) {
      // Get result from the result message
      if (message.type === 'result' && (message as any).subtype === 'success') {
        const r = (message as any).result;
        if (r) resultText = r;
      }
      // Also collect from assistant messages
      if (message.type === 'assistant' && (message as any).message?.content) {
        for (const block of (message as any).message.content) {
          if (block.type === 'text' && !resultText) {
            resultText += block.text;
          }
        }
      }
    }

    if (!resultText) {
      return res.status(200).json({ text: 'I processed your request but have no response. Please try again.' });
    }

    return res.status(200).json({ text: resultText });
  } catch (error: any) {
    console.error('Nemo error:', error);
    return res.status(200).json({ text: `Sorry, I encountered an error: ${error.message || 'Unknown error'}. Please try again.` });
  }
}
