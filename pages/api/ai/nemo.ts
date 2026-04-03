import type { NextApiRequest, NextApiResponse } from 'next';
import { sendToOpenClaw } from '../../../lib/openclaw-client';
import type { ChatMessage } from '../../../lib/openclaw-client';
import { NEMO_TOOLS } from '../../../lib/nemo-tools';

type ChatRole = 'user' | 'assistant';

interface IncomingMessage {
  role: ChatRole | 'model';
  content?: string;
  text?: string;
}

interface ChatUserContext {
  id: string;
  email?: string;
  role?: string;
  name?: string;
  employeeId?: string | null;
}

function normalizeRole(role?: string): string {
  if (!role) return 'STAFF';
  return role.replace(/\s+/g, '_').toUpperCase();
}

function getRolePermissions(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'This user is an ADMIN. They can ask about courses, trainers, learners, finance, system settings, schedules, and platform operations.';
    case 'TRAINING_PROVIDER':
      return 'This user is a TRAINING PROVIDER administrator. They can ask about organization settings, templates, users, finance, documents, and training operations.';
    case 'FINANCE':
      return 'This user is FINANCE staff. They can ask about grants, claims, billing, payments, and financial records.';
    case 'TRAINER':
      return 'This user is a TRAINER. They can ask about their classes, attendance, assessments, and trainer workflows.';
    case 'DEVELOPER':
      return 'This user is a DEVELOPER. They can ask about course content, authoring workflows, and development-related operations.';
    case 'LEARNER':
    default:
      return 'This user is a LEARNER or general staff user. Limit answers to their own learning and general platform guidance unless the platform role allows more.';
  }
}

function buildSystemPrompt(user: ChatUserContext, customSystemPrompt?: string): string {
  const normalizedRole = normalizeRole(user.role);
  const lines = [
    'You are Nemo, the AI operations assistant for the Tertiary Infotech LMS/TMS platform.',
    `User: ${user.name || user.email || user.id} (ID: ${user.id})`,
  ];

  if (user.email) lines.push(`Email: ${user.email}`);
  if (user.role) lines.push(`Role: ${user.role}`);
  if (user.employeeId) lines.push(`Employee ID: ${user.employeeId}`);

  lines.push(
    '',
    getRolePermissions(normalizedRole),
    '',
    'Help them with LMS, TMS, admin, finance, training, and operational queries using your available tools.',
  );

  if (customSystemPrompt?.trim()) {
    lines.push('', customSystemPrompt.trim());
  }

  return lines.join('\n');
}

function coerceMessages(messages: IncomingMessage[]): Array<{ role: ChatRole; content: string }> {
  return messages
    .map(message => ({
      role: message.role === 'model' ? 'assistant' : (message.role as ChatRole),
      content: (message.content || message.text || '').trim(),
    }))
    .filter(message => message.content.length > 0);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, currentUser, systemPrompt } = req.body as {
      messages?: IncomingMessage[];
      currentUser?: ChatUserContext;
      systemPrompt?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    if (!currentUser?.id) {
      return res.status(401).json({ error: 'Missing authenticated user context' });
    }

    const normalizedMessages = coerceMessages(messages).slice(-10);

    if (normalizedMessages.length === 0) {
      return res.status(400).json({ error: 'No valid messages found' });
    }

    // Build OpenAI-format messages: system prompt + conversation history
    const openAiMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(currentUser, systemPrompt) },
      ...normalizedMessages,
    ];

    const text = await sendToOpenClaw({
      messages: openAiMessages,
      tools: NEMO_TOOLS,
      timeoutMs: 120000,
      userId: currentUser.id,
    });

    return res.status(200).json({ text });
  } catch (error: any) {
    console.error('Nemo OpenClaw bridge error:', error);
    return res.status(502).json({
      error: error?.message || 'OpenClaw chat service unavailable',
    });
  }
}
