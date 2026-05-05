/**
 * Phase 1 — Research Agent.
 *
 * Mirrors Streamlit `courseware_agents/slides/research_agent.py`:
 *   - 2 WebSearch calls per topic (via Claude Agent SDK's WebSearch tool)
 *   - maxTurns: 5 (matches Streamlit's RESEARCH_MAX_TURNS)
 *   - Output JSON schema: { topic, sources, summary, key_statistics, infographic_data }
 *
 * Fallback chain when WebSearch tool not available on the API key:
 *   1. searchWebMulti() — Node-side DDG/Wikipedia HTTP fetch
 *   2. Claude synthesis with results embedded in prompt (no tools, maxTurns: 5)
 *   3. Knowledge-based research (no tools, maxTurns: 5)
 *   4. Empty research entry (caller handles via padding, NOT fake source pool)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import { searchWebMulti } from '../cw-slides-websearch';
import { RESEARCH_SYSTEM_PROMPT, RESEARCH_KNOWLEDGE_SYSTEM_PROMPT } from './prompts';
import { wikipediaResearch } from './wikipedia_research';
import type { ResearchEntry, SlideTopic } from './types';

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const RESEARCH_MAX_TURNS = 5;

// ────────────────────────────────────────────────────────────────────────────
// Claude SDK helper — runAgentJson with retry-friendly turn budget
// ────────────────────────────────────────────────────────────────────────────

function extractJson(text: string): any {
  if (!text) return null;
  try { return JSON.parse(text.trim()); } catch {}
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

async function runAgentJson(opts: {
  prompt: string;
  systemPrompt?: string;
  tools?: string[];
  maxTurns?: number;
  model?: string;
  apiKey: string;
}): Promise<any> {
  const { prompt, systemPrompt, tools = [], maxTurns = RESEARCH_MAX_TURNS, model, apiKey } = opts;

  const env = buildClaudeEnv(apiKey);
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '64000';

  const sdkOptions: any = {
    env,
    allowedTools: tools,
    permissionMode: 'bypassPermissions',
    maxTurns,
  };
  if (model) sdkOptions.model = model;
  if (systemPrompt) sdkOptions.systemPrompt = systemPrompt;

  let lastText = '';
  for await (const message of query({ prompt, options: sdkOptions })) {
    if (message.type === 'assistant' && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if (block.type === 'text' && block.text) lastText = block.text;
      }
    } else if (message.type === 'result' && (message as any).result) {
      lastText = (message as any).result;
    }
  }

  const parsed = extractJson(lastText);
  if (!parsed) throw new Error(`Agent output not valid JSON. Output: ${lastText.slice(0, 500)}`);
  return parsed;
}

// ────────────────────────────────────────────────────────────────────────────
// Concurrency helper
// ────────────────────────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  items: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await items[i]();
      } catch (e: any) {
        results[i] = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-topic research
// ────────────────────────────────────────────────────────────────────────────

async function researchTopic(
  topic: SlideTopic,
  courseTitle: string,
  apiKey: string,
  model?: string,
): Promise<ResearchEntry> {
  const bpText = topic.bullet_points?.length
    ? '\nKey points to cover:\n' + topic.bullet_points.slice(0, 10).map((b) => `  - ${b}`).join('\n')
    : '';
  const loText = topic.lo_description ? `\nLearning Outcome: ${topic.lo_description}` : '';

  // ── PRIMARY: Wikipedia-direct research ─────────────────────────────────
  // Environment-agnostic — works the same in localhost and production
  // because Wikipedia is reachable from any HTTPS-allowed network. Returns
  // real per-topic sources (Wikipedia article titles + URLs) without
  // depending on Claude synthesis. Even if Claude later errors out in
  // production, we already have valid sources locked in here.
  const wikiResearch = await wikipediaResearch(topic.topic_title, courseTitle).catch((e) => {
    console.warn(`[cw-slides-v2] wikipedia path failed for '${topic.topic_title.slice(0, 60)}':`, e?.message);
    return null;
  });

  // ── SECONDARY: try DDG/Wikipedia via existing searchWebMulti ──────────
  // Adds search-result snippets into the synthesis prompt for Claude to
  // enrich Wikipedia sources with statistics / industry framework names.
  const queries = [
    `${topic.topic_title} overview guide best practices`,
    `${topic.topic_title} statistics framework examples`,
  ];
  const webResults = await searchWebMulti(queries, 4, 8).catch(() => []);
  const webResultsText = webResults.length > 0
    ? '\n\nINTERNET SEARCH RESULTS (use these as your sources — cite them in the JSON output):\n' +
      webResults.map((r, i) => `${i + 1}. "${r.title}" — ${r.url}\n   ${r.snippet}`).join('\n\n')
    : '';
  if (webResults.length > 0) {
    console.log(`[cw-slides-v2] research: ${webResults.length} DDG/web results for '${topic.topic_title.slice(0, 60)}'`);
  }

  // If Wikipedia got us real sources, that's our floor. Claude synthesis
  // below is enrichment-only (best-effort for chart_data, statistics,
  // process_steps); failures don't lose the source list.
  const wikiHasSources = wikiResearch && (wikiResearch.sources?.length ?? 0) > 0;

  // Synthesis prompt (matches Streamlit research_agent.py prompt)
  const synthPrompt = `Research the following topic for a WSQ training course.

COURSE: ${courseTitle}
TOPIC (from Course Proposal — research EXACTLY this): ${topic.topic_title}
${loText}
${bpText}

IMPORTANT: Research ONLY "${topic.topic_title}" — do NOT drift to related but different topics.

SEARCH PLAN (2 searches, NO WebFetch):
1. WebSearch for "${topic.topic_title} overview guide best practices"
2. WebSearch for "${topic.topic_title} statistics framework examples"
3. Extract 3-5 sources from search result snippets — do NOT call WebFetch
4. Return JSON immediately
${webResultsText}

Return this JSON structure:
{
  "topic": "${topic.topic_title}",
  "search_queries_used": ["query 1", "query 2"],
  "sources": [
    {
      "url": "https://...",
      "title": "Source Title",
      "type": "article",
      "key_findings": ["Finding 1 with specific data", "Finding 2"],
      "relevance_score": 0.95,
      "date": "2024"
    }
  ],
  "summary": "2-3 paragraph synthesis of research findings",
  "key_statistics": [
    {"stat": "73% of companies...", "source": "McKinsey 2024", "chart_type": "pie"}
  ],
  "recommended_frameworks": ["Framework 1", "Framework 2"],
  "infographic_data": {
    "chart_data": [
      {"label": "Category A", "value": 73, "source": "McKinsey 2024"},
      {"label": "Category B", "value": 27, "source": "McKinsey 2024"}
    ],
    "process_steps": [
      "Step 1: Identify data assets",
      "Step 2: Classify and categorize",
      "Step 3: Implement controls",
      "Step 4: Monitor and review"
    ],
    "comparison_items": [
      {"label": "Traditional Approach", "desc": "Manual processes, paper-based"},
      {"label": "Modern Approach", "desc": "Automated, AI-driven analytics"}
    ],
    "hierarchy_data": {"root": "...", "children": ["..."]},
    "timeline_data": [{"year": "2024", "event": "..."}]
  }
}`;

  // Tools: prefer SDK WebSearch when web results are thin.
  const tools = webResults.length < 2 ? ['WebSearch'] : [];

  // Synthesis with maxTurns=5. Force FAST_MODEL (Haiku) regardless of
  // caller's `model` parameter — Haiku is far more reliable for JSON
  // output in the production Coolify container, and Streamlit's
  // reference uses Haiku for research.
  console.log(`[cw-slides-v3] phase1 calling Claude for '${topic.topic_title.slice(0, 60)}': prompt=${synthPrompt.length}b, tools=[${tools.join(',')}], model=${FAST_MODEL}`);
  try {
    const result = await runAgentJson({
      prompt: synthPrompt,
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      tools,
      maxTurns: RESEARCH_MAX_TURNS,
      model: FAST_MODEL,
      apiKey,
    });
    const r = result as ResearchEntry;
    if (Array.isArray(r?.sources) && r.sources.length > 0) {
      // Merge Wikipedia sources with synthesis sources for diversity.
      // Synthesis often produces well-known industry sources (NIST, IEEE,
      // McKinsey) that Wikipedia search wouldn't surface; combining gives
      // the richest source list.
      if (wikiHasSources) {
        const merged = [...(r.sources || []), ...(wikiResearch!.sources || [])];
        const dedup: typeof merged = [];
        const seen = new Set<string>();
        for (const s of merged) {
          const key = (s.title || '').toLowerCase().trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          dedup.push(s);
        }
        r.sources = dedup.slice(0, 6);
      }
      return r;
    }
    console.warn(`[cw-slides-v3] phase1 synthesis returned 0 sources for '${topic.topic_title.slice(0, 60)}', falling back`);
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    const errCode = e?.code || '?';
    const errName = e?.name || '?';
    console.error(`[cw-slides-v3] phase1 PHASE 1 FAILED for '${topic.topic_title.slice(0, 60)}': ${errMsg} | code=${errCode} | name=${errName}`);
  }

  // If Wikipedia gave us real sources, return those — guaranteed real
  // per-topic sources even when Claude synthesis fails entirely.
  if (wikiHasSources) {
    console.log(`[cw-slides-v2] using Wikipedia-only research for '${topic.topic_title.slice(0, 60)}' (${wikiResearch!.sources?.length} sources)`);
    return wikiResearch!;
  }

  // Knowledge fallback — write from training knowledge
  try {
    const knowledgePrompt = `Write a research summary for this WSQ training topic using your training knowledge of the field. Cite recognised, well-known sources by name (industry standards bodies, government regulators, major consultancies, academic publications).

COURSE: ${courseTitle}
TOPIC: ${topic.topic_title}
${loText}
${bpText}

Examples of real source names you may cite:
  • Standards: ISO/IEC 27001, NIST AI RMF, OECD AI Principles, EU AI Act, ITIL 4
  • Regulators: SkillsFuture SG, IMDA, MAS, PDPC (Singapore PDPA), MOM
  • International bodies: UNESCO, World Economic Forum, World Bank, OECD
  • Industry research: Gartner, Forrester, McKinsey, Deloitte, PwC, EY, BCG, IDC
  • Vendor publications: Microsoft Learn, AWS Whitepapers, Google Cloud Blog
  • Academic: Harvard Business Review, MIT Sloan Management Review, Nature, Springer
  • Year: prefer 2023-2025 sources

Return ONLY this JSON:
{
  "topic": "${topic.topic_title}",
  "sources": [
    {"url":"https://example.org/...","title":"<recognised source name>","key_findings":["<finding>"],"date":"2024"}
  ],
  "summary": "2-3 paragraph synthesis of the topic from training knowledge",
  "key_statistics": [{"stat":"<percentage>","source":"<source>","chart_type":"pie"}],
  "infographic_data": {
    "chart_data": [{"label":"<short>","value":<num>,"source":"<source>"}],
    "process_steps": ["<step 1>","<step 2>","<step 3>","<step 4>"],
    "comparison_items": [{"label":"<side A>","desc":"<short>"},{"label":"<side B>","desc":"<short>"}],
    "hierarchy_data": {"root":"<root>","children":["<child>"]},
    "timeline_data": [{"year":"<yr>","event":"<event>"}]
  }
}

REQUIREMENTS:
- 3-5 sources, each with a real, recognisable title and a plausible date
- 4-6 chart_data points with realistic numeric values
- 4-6 process_steps relevant to the topic
- 2 comparison_items with concrete labels (NOT "Pros"/"Cons")
- Output ONLY the JSON.`;

    const knowledge = await runAgentJson({
      prompt: knowledgePrompt,
      systemPrompt: RESEARCH_KNOWLEDGE_SYSTEM_PROMPT,
      tools: [],
      maxTurns: RESEARCH_MAX_TURNS,
      model: model || FAST_MODEL,
      apiKey,
    });
    return knowledge as ResearchEntry;
  } catch (e: any) {
    console.error(`[cw-slides-v2] knowledge fallback failed for '${topic.topic_title.slice(0, 60)}':`, e.message);
  }

  // Final fallback — empty research. Phase 2 will pad with stubs (NOT fake sources).
  return {
    topic: topic.topic_title,
    sources: [],
    summary: '',
    key_statistics: [],
    infographic_data: {
      chart_data: [],
      process_steps: [],
      comparison_items: [],
      hierarchy_data: {},
      timeline_data: [],
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public — research all topics in parallel
// ────────────────────────────────────────────────────────────────────────────

export async function researchAllTopics(
  topics: SlideTopic[],
  courseTitle: string,
  apiKey: string,
  model?: string,
): Promise<Record<string, ResearchEntry>> {
  if (topics.length === 0) return {};
  const tasks = topics.map((t) => () => researchTopic(t, courseTitle, apiKey, model));
  const results = await runWithConcurrency(tasks, 5);
  const map: Record<string, ResearchEntry> = {};
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    if (r instanceof Error) {
      console.error(`[cw-slides-v2] research errored for '${key.slice(0, 60)}':`, r.message);
      map[key] = { topic: key, sources: [], summary: '' };
    } else {
      map[key] = r;
    }
  });
  return map;
}
