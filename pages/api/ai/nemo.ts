import type { NextApiRequest, NextApiResponse } from 'next';
import { sendToOpenClaw, sendToMiniMaxDirect } from '../../../lib/openclaw-client';
import type { ChatMessage } from '../../../lib/openclaw-client';
import { executeTool } from '../../../lib/nemo-tools';
import pool from '../../../lib/db';

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

  // Day-of-week class queries, e.g. "how many classes on monday"
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(msg) &&
      /\b(class|course|run|session)\b/.test(msg) &&
      !matches.some(m => m.tool === 'search_course_runs')) {
    const today = new Date().toISOString().split('T')[0];
    matches.push({ tool: 'search_course_runs', args: { start_date_from: today, limit: 50 } });
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

function formatRawResults(results: string[]): string {
  const lines = ['Here\'s what I found from the database:\n'];
  for (const result of results) {
    try {
      const colonIdx = result.indexOf(':\n');
      if (colonIdx === -1) { lines.push(result); continue; }
      const toolName = result.substring(0, colonIdx);
      const json = JSON.parse(result.substring(colonIdx + 2));
      lines.push(`**${toolName}**`);
      if (json.count !== undefined) lines.push(`- Total results: ${json.count}`);
      const dataKey = Object.keys(json).find(k => Array.isArray(json[k]));
      if (dataKey) {
        for (const item of json[dataKey].slice(0, 10)) {
          const label = item.course_title || item.title || item.name || item.trainee_name || item.claim_id || item.grant_id || item.label || JSON.stringify(item).substring(0, 80);
          const status = item.class_status || item.status || item.enrolment_status || item.claim_status || '';
          lines.push(`- ${label}${status ? ` (${status})` : ''}`);
        }
      }
    } catch {
      lines.push(result);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Default LLM provider resolution — uses the configured default from DB
// ---------------------------------------------------------------------------

interface LLMProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
}

async function getDefaultLLMProvider(userId: string): Promise<LLMProviderConfig | null> {
  try {
    const result = await pool.query(`
      SELECT key_name, key_value, selected_model
      FROM training_provider_api
      WHERE training_provider_id = COALESCE(
        (SELECT provider_id FROM training_provider_member WHERE user_id = $1 LIMIT 1),
        (SELECT provider_id FROM provider_admin_user WHERE user_id = $1 LIMIT 1),
        (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
      )
    `, [userId]);

    let defaultProviderKey: string | null = null;
    const configs: Record<string, { apiKey: string; model: string | null }> = {};

    for (const row of result.rows) {
      if (row.key_name === 'DEFAULT_AI_PROVIDER') {
        defaultProviderKey = row.key_value;
      } else if (row.key_value && row.key_name.endsWith('_API_KEY')) {
        configs[row.key_name] = { apiKey: row.key_value, model: row.selected_model };
      }
    }

    // Fall back to Anthropic if no default set
    if (!defaultProviderKey) {
      if (configs['ANTHROPIC_API_KEY']?.apiKey) defaultProviderKey = 'ANTHROPIC_API_KEY';
      else if (configs['GEMINI_API_KEY']?.apiKey) defaultProviderKey = 'GEMINI_API_KEY';
    }

    if (!defaultProviderKey || !configs[defaultProviderKey]) return null;

    const c = configs[defaultProviderKey];
    const defaultModels: Record<string, string> = {
      ANTHROPIC_API_KEY: 'claude-sonnet-4-6-20250527',
      OPENAI_API_KEY: 'gpt-4o',
      GEMINI_API_KEY: 'gemini-2.5-flash',
      MINIMAX_API_KEY: 'MiniMax-M2.7',
      KIMI_API_KEY: 'moonshot-v1-8k',
      DEEPSEEK_API_KEY: 'deepseek-chat',
    };

    return {
      provider: defaultProviderKey,
      apiKey: c.apiKey,
      model: c.model || defaultModels[defaultProviderKey] || 'claude-sonnet-4-6-20250527',
    };
  } catch (err) {
    console.error('[Nemo] Failed to get default LLM provider:', err);
    return null;
  }
}

async function callDefaultLLM(config: LLMProviderConfig, messages: ChatMessage[]): Promise<string> {
  const { provider, apiKey, model } = config;
  console.log(`[Nemo] Using default LLM: ${provider} / ${model}`);

  if (provider === 'ANTHROPIC_API_KEY') {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const body: any = {
      model,
      max_tokens: 4096,
      messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.content?.[0]?.text || '';
  }

  if (provider === 'GEMINI_API_KEY') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });
    const prompt = messages.map(m => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : 'Assistant'}: ${m.content}`).join('\n');
    const result = await geminiModel.generateContent(prompt);
    return (await result.response).text();
  }

  // OpenAI-compatible providers (OpenAI, MiniMax, Kimi, DeepSeek)
  const endpoints: Record<string, string> = {
    OPENAI_API_KEY: 'https://api.openai.com/v1/chat/completions',
    MINIMAX_API_KEY: 'https://api.minimaxi.chat/v1/chat/completions',
    KIMI_API_KEY: 'https://api.moonshot.cn/v1/chat/completions',
    DEEPSEEK_API_KEY: 'https://api.deepseek.com/chat/completions',
  };
  const endpoint = endpoints[provider];
  if (!endpoint) throw new Error(`Unsupported provider: ${provider}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
    }),
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}: ${await response.text()}`);
  const data = await response.json();
  // MiniMax returns errors with 200 status in base_resp
  if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`${provider} error: ${data.base_resp.status_msg || 'Unknown error'} (code ${data.base_resp.status_code})`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider} returned empty response`);
  // Strip <think>...</think> reasoning blocks (e.g. MiniMax M2.7)
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
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

    // Resolve the default LLM provider from DB config
    const llmProvider = await getDefaultLLMProvider(currentUser.id);

    let text: string;

    if (toolMatches.length > 0) {
      // Data query — run DB tools, then send results to LLM for formatting
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
      const toolContext = `\n\n--- Database Results (live data from LMS/TMS) ---\n${results.join('\n\n')}\n--- End Results ---\n\nUse bullet points instead of markdown tables for readability.`;

      const llmMessages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(currentUser, systemPrompt) + toolContext },
        ...normalizedMessages,
      ];

      // Use the default LLM provider to format results; fall back to OpenClaw, then raw data
      try {
        if (llmProvider) {
          text = await callDefaultLLM(llmProvider, llmMessages);
        } else {
          console.log('[Nemo] No default LLM configured, falling back to OpenClaw');
          text = await sendToOpenClaw({ messages: llmMessages, timeoutMs: 60000, userId: currentUser.id });
        }
      } catch (llmError: any) {
        console.error('[Nemo] LLM call failed:', llmError.message);
        // Try OpenClaw as fallback if default LLM failed
        try {
          if (llmProvider) {
            text = await sendToOpenClaw({ messages: llmMessages, timeoutMs: 60000, userId: currentUser.id });
          } else {
            text = formatRawResults(results);
          }
        } catch {
          text = formatRawResults(results);
        }
      }
    } else {
      // Simple Q&A — use default LLM provider, fall back to OpenClaw
      const llmMessages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(currentUser, systemPrompt) },
        ...normalizedMessages,
      ];

      try {
        if (llmProvider) {
          console.log(`[Nemo] No tools matched, using default LLM: ${llmProvider.provider} / ${llmProvider.model}`);
          text = await callDefaultLLM(llmProvider, llmMessages);
        } else {
          console.log('[Nemo] No tools matched, no default LLM configured, using OpenClaw');
          text = await sendToOpenClaw({ messages: llmMessages, timeoutMs: 60000, userId: currentUser.id });
        }
      } catch (error: any) {
        // Try OpenClaw as fallback
        if (llmProvider) {
          try {
            console.log('[Nemo] Default LLM failed, falling back to OpenClaw');
            text = await sendToOpenClaw({ messages: llmMessages, timeoutMs: 60000, userId: currentUser.id });
          } catch (fallbackError: any) {
            throw new Error(fallbackError?.message || "I'm having trouble connecting to the AI service right now. Please try again in a moment.");
          }
        } else {
          throw new Error(error?.message || "I'm having trouble connecting to the AI service right now. Please try again in a moment.");
        }
      }
    }

    return res.status(200).json({ text });
  } catch (error: any) {
    console.error('Nemo OpenClaw bridge error:', error);
    return res.status(502).json({
      error: error?.message || 'OpenClaw chat service unavailable',
    });
  }
}
