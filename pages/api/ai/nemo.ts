import type { NextApiRequest, NextApiResponse } from 'next';
import { sendToOpenClaw } from '../../../lib/openclaw-client';
import type { ChatMessage } from '../../../lib/openclaw-client';
import { executeTool } from '../../../lib/nemo-tools';

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

// ---------------------------------------------------------------------------
// Keyword-based tool router — decides which DB queries to run based on the
// user's message, executes them, and injects results as context for OpenClaw.
// ---------------------------------------------------------------------------

interface ToolMatch {
  tool: string;
  args: Record<string, any>;
}

function detectTools(message: string): ToolMatch[] {
  const msg = message.toLowerCase();
  const matches: ToolMatch[] = [];

  // Dashboard / summary / overview
  if (/\b(dashboard|summary|overview|status|how.?s (everything|things|the platform))\b/.test(msg)) {
    matches.push({ tool: 'get_dashboard_summary', args: {} });
  }

  // Course runs without trainers
  if (/\b(no trainer|without trainer|unassigned|trainer.{0,10}(not|missing)|missing trainer|need.{0,10}trainer)\b/.test(msg)) {
    matches.push({ tool: 'search_course_runs', args: { has_trainer: false } });
  }

  // Upcoming classes / course runs
  if (/\b(upcoming|next|future|scheduled|coming)\b.*\b(class|course|run|session)\b/.test(msg) && !matches.some(m => m.tool === 'search_course_runs')) {
    const today = new Date().toISOString().split('T')[0];
    matches.push({ tool: 'search_course_runs', args: { start_date_from: today } });
  }

  // Search course runs by keyword
  if (/\b(find|search|look.?up|show|list|get)\b.*\b(class|course|run)\b/.test(msg) && !matches.some(m => m.tool === 'search_course_runs')) {
    // Extract potential search terms after the action word
    const searchMatch = msg.match(/(?:find|search|look.?up|show|list|get)\b.*?\b(?:class|course|run)e?s?\b\s+(?:for\s+|about\s+|on\s+|named?\s+)?(.+?)(?:\?|$)/);
    const search = searchMatch?.[1]?.trim();
    matches.push({ tool: 'search_course_runs', args: search ? { search } : {} });
  }

  // Course run details by ID
  const runIdMatch = msg.match(/\b(course.?run|class|run)\b.*?\b([A-Z]{2,}-\d[\w-]*)\b/i) || msg.match(/\b([A-Z]{2,}-\d[\w-]*)\b.*?\b(detail|info|about)\b/i);
  if (runIdMatch) {
    const runId = (runIdMatch[2] || runIdMatch[1]).toUpperCase();
    if (/^[A-Z]/.test(runId)) {
      matches.push({ tool: 'get_course_run_details', args: { course_run_id: runId } });
    }
  }

  // Trainers
  if (/\b(trainer|instructor|facilitator)\b/.test(msg) && /\b(list|show|all|available|active|who|find|search)\b/.test(msg)) {
    matches.push({ tool: 'list_trainers', args: { status: 'Active' } });
  }

  // Enrolments
  if (/\b(enrol|enrollment|learner|student)\b/.test(msg) && /\b(list|show|search|find|pending|unpaid|check)\b/.test(msg)) {
    const args: Record<string, any> = {};
    if (/\bunpaid\b/.test(msg)) args.payment_status = 'Unpaid';
    if (/\bpending\b/.test(msg)) args.enrolment_status = 'Pending';
    matches.push({ tool: 'search_enrolments', args });
  }

  // Claims
  if (/\b(claim)\b/.test(msg)) {
    const args: Record<string, any> = {};
    if (/\b(outstanding|pending|unpaid|overdue)\b/.test(msg)) args.outstanding_only = true;
    matches.push({ tool: 'search_claims', args });
  }

  // Grants
  if (/\b(grant)\b/.test(msg) && /\b(list|show|search|find|check|status|pending)\b/.test(msg)) {
    const args: Record<string, any> = {};
    if (/\bpending\b/.test(msg)) args.status = 'Pending';
    matches.push({ tool: 'search_grants', args });
  }

  // Course validity / funding
  if (/\b(valid|validity|funding|expire|expir)\b/.test(msg)) {
    const codeMatch = msg.match(/\b(TGS-\d+)\b/i);
    matches.push({ tool: 'check_course_validity', args: codeMatch ? { course_code: codeMatch[1].toUpperCase() } : { search: '%' } });
  }

  // Attendance
  if (/\b(attendance)\b/.test(msg) && /\b(check|show|view|summary|record)\b/.test(msg)) {
    // Need a session ID — if not provided, suggest getting sessions first
    matches.push({ tool: 'get_dashboard_summary', args: {} });
  }

  // If nothing matched but it seems like a data query, get dashboard summary as context
  if (matches.length === 0 && /\b(how many|count|total|what|which|check|show me|tell me)\b/.test(msg)) {
    matches.push({ tool: 'get_dashboard_summary', args: {} });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRole(role?: string): string {
  if (!role) return 'STAFF';
  return role.replace(/\s+/g, '_').toUpperCase();
}

function getRolePermissions(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'This user is an ADMIN with full platform access.';
    case 'TRAINING_PROVIDER':
      return 'This user is a TRAINING PROVIDER administrator.';
    case 'FINANCE':
      return 'This user is FINANCE staff focused on grants, claims, and billing.';
    case 'TRAINER':
      return 'This user is a TRAINER managing classes and attendance.';
    case 'DEVELOPER':
      return 'This user is a DEVELOPER managing course content.';
    case 'LEARNER':
    default:
      return 'This user is a LEARNER.';
  }
}

function buildSystemPrompt(user: ChatUserContext, customSystemPrompt?: string): string {
  const normalizedRole = normalizeRole(user.role);
  const lines = [
    'You are Nemo, the AI operations assistant for the Tertiary Infotech LMS/TMS platform.',
    'You have DIRECT ACCESS to the platform database. When data is provided below under "Database Results", use it to answer the user accurately.',
    'Format data in clean, readable tables or bullet points. Be concise and actionable.',
    'If the data shows issues (e.g. classes without trainers, outstanding claims), proactively highlight them.',
    '',
    `User: ${user.name || user.email || user.id} | Role: ${user.role || 'Staff'}`,
    getRolePermissions(normalizedRole),
  ];

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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

    // Get the latest user message for tool detection
    const lastUserMessage = [...normalizedMessages].reverse().find(m => m.role === 'user');
    const userQuery = lastUserMessage?.content || '';

    // Detect and execute relevant tools based on keywords
    const toolMatches = detectTools(userQuery);
    let toolContext = '';

    if (toolMatches.length > 0) {
      console.log(`[Nemo] Detected ${toolMatches.length} tools: ${toolMatches.map(m => m.tool).join(', ')}`);
      const startTime = Date.now();

      const results = await Promise.all(
        toolMatches.map(async ({ tool, args }) => {
          try {
            const result = await executeTool(tool, args);
            return `${tool}(${JSON.stringify(args)}):\n${result}`;
          } catch (error: any) {
            return `${tool}: Error - ${error.message}`;
          }
        })
      );

      console.log(`[Nemo] All tools completed in ${Date.now() - startTime}ms`);
      toolContext = `\n\n--- Database Results (live data from LMS/TMS) ---\n${results.join('\n\n')}\n--- End Results ---`;
    }

    // Build messages for OpenClaw
    const openAiMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(currentUser, systemPrompt) + toolContext },
      ...normalizedMessages,
    ];

    const text = await sendToOpenClaw({
      messages: openAiMessages,
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
