/**
 * Phase 1 — Research Agent (Messages API edition).
 *
 * Architecture:
 *   1. HTTP web search via searchWebMulti (DDG + Wikipedia REST) — no auth,
 *      no Anthropic gating, works in any container with HTTPS egress.
 *   2. Wikipedia REST as a guaranteed source backstop.
 *   3. Anthropic Messages API (direct HTTPS, NO Claude Agent SDK / CLI
 *      subprocess) synthesises real search snippets into structured JSON
 *      with sources, statistics, and infographic_data.
 *
 * Why this shape:
 *   - The Agent SDK runs the Claude Code CLI as a subprocess. In your
 *     Coolify container the CLI binary / network egress / OOM combo
 *     intermittently fails, which silently dropped Phase 1 → Phase 2 fell
 *     back → 100% padded slides on every deploy.
 *   - The Messages API is the SAME endpoint the CP / AP / FG / LG
 *     generators use (cw-generate.ts) — it works in production today.
 *   - DDG/Wikipedia search runs in-process, so WebSearch never depends
 *     on the SDK's CLI WebSearch tool nor Anthropic's gated
 *     web_search_20250305 server tool (which doesn't accept OAuth
 *     subscription tokens anyway).
 *
 * Failure handling:
 *   - HTTP search failure → still try Wikipedia REST.
 *   - Messages API failure (truly rare — same auth as cw-generate) →
 *     return a research entry with HTTP/Wiki sources and empty synthesis
 *     so Phase 2 can still produce on-topic content.
 */

import { searchWebMulti } from '../cw-slides-websearch';
import { wikipediaResearch } from './wikipedia_research';
import { callClaudeJson } from './anthropic-messages';
import { RESEARCH_SYSTEM_PROMPT } from './prompts';
import type { ResearchEntry, SlideTopic } from './types';

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const RESEARCH_CONCURRENCY = 5;
const RESEARCH_MAX_TOKENS = 4096;

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
): Promise<ResearchEntry> {
  const bpText = topic.bullet_points?.length
    ? '\nKey points to cover:\n' + topic.bullet_points.slice(0, 10).map((b) => `  - ${b}`).join('\n')
    : '';
  const loText = topic.lo_description ? `\nLearning Outcome: ${topic.lo_description}` : '';

  // ── Step 1: HTTP web search (DDG + Wikipedia, no auth) ────────────────
  const queries = [
    `${topic.topic_title} overview guide best practices`,
    `${topic.topic_title} statistics framework examples`,
  ];
  const webResults = await searchWebMulti(queries, 4, 8).catch((e) => {
    console.warn(`[cw-slides-v3] phase1 searchWebMulti failed for '${topic.topic_title.slice(0, 60)}':`, e?.message);
    return [];
  });
  console.log(`[cw-slides-v3] phase1 web search: ${webResults.length} results for '${topic.topic_title.slice(0, 60)}'`);

  // ── Step 2: Wikipedia REST research (guaranteed sources) ──────────────
  const wikiResearch = await wikipediaResearch(topic.topic_title, courseTitle).catch((e) => {
    console.warn(`[cw-slides-v3] phase1 wikipedia failed for '${topic.topic_title.slice(0, 60)}':`, e?.message);
    return null;
  });
  const wikiSources = wikiResearch?.sources ?? [];

  // ── Step 3: Build synthesis prompt with all real search results ───────
  const webResultsText = webResults.length > 0
    ? '\n\nINTERNET SEARCH RESULTS — cite these as your sources in the JSON output:\n' +
      webResults.map((r, i) => `${i + 1}. "${r.title}" — ${r.url}\n   ${r.snippet}`).join('\n\n')
    : '';

  const wikiText = wikiSources.length > 0
    ? '\n\nWIKIPEDIA SOURCES — these are also valid citations:\n' +
      wikiSources.slice(0, 4).map((s, i) => `${i + 1}. "${s.title}" — ${s.url}`).join('\n')
    : '';

  const synthPrompt = `Research the following topic for a WSQ training course.

COURSE: ${courseTitle}
TOPIC (from Course Proposal — research EXACTLY this): ${topic.topic_title}
${loText}
${bpText}

CRITICAL: Research ONLY "${topic.topic_title}" — do not drift to related but different topics.

You have been given REAL internet search results below. Use them as the source material — do NOT invent URLs. Pick the 3-5 most relevant results and structure them as the "sources" list. Extract concrete facts, statistics, frameworks, and examples from the snippets.${webResultsText}${wikiText}

Return this JSON structure (and ONLY this JSON, no preamble or commentary):
{
  "topic": "${topic.topic_title}",
  "search_queries_used": ${JSON.stringify(queries)},
  "sources": [
    {
      "url": "https://… (must come from the search results above)",
      "title": "Source Title",
      "type": "article",
      "key_findings": ["Specific factual finding from the snippet", "Another finding"],
      "relevance_score": 0.95,
      "date": "2024"
    }
  ],
  "summary": "2-3 paragraph synthesis grounded in the search results — NO speculation",
  "key_statistics": [
    {"stat": "73% of companies adopted X by 2024", "source": "<source name from results>", "chart_type": "pie"}
  ],
  "recommended_frameworks": ["Framework 1", "Framework 2"],
  "infographic_data": {
    "chart_data": [
      {"label": "Category A", "value": 73, "source": "<source>"},
      {"label": "Category B", "value": 27, "source": "<source>"}
    ],
    "process_steps": [
      "Step 1: Concrete action grounded in the topic",
      "Step 2: …",
      "Step 3: …",
      "Step 4: …"
    ],
    "comparison_items": [
      {"label": "Specific concept A", "desc": "Concrete short description"},
      {"label": "Specific concept B", "desc": "Concrete short description"}
    ],
    "hierarchy_data": {"root": "<root concept>", "children": ["<child 1>", "<child 2>"]},
    "timeline_data": [{"year": "2024", "event": "Concrete event"}]
  }
}

REQUIREMENTS:
- 3-5 sources, each with a real URL from the search results above (no invented URLs)
- 4-6 chart_data points with realistic numeric values (cite the source)
- 4-6 process_steps specific to "${topic.topic_title}" (NOT generic "review/apply/discuss")
- 2 comparison_items with concrete labels (NOT "Pros"/"Cons")
- Output ONLY the JSON object.`;

  // ── Step 4: Synthesise via Messages API ───────────────────────────────
  console.log(`[cw-slides-v3] phase1 synthesising '${topic.topic_title.slice(0, 60)}': prompt=${synthPrompt.length}b, model=${FAST_MODEL}`);
  try {
    const result = await callClaudeJson({
      apiKey,
      model: FAST_MODEL,
      system: RESEARCH_SYSTEM_PROMPT,
      prompt: synthPrompt,
      maxTokens: RESEARCH_MAX_TOKENS,
      maxRetries: 2,
    });
    const r = result as ResearchEntry;
    if (Array.isArray(r?.sources) && r.sources.length > 0) {
      // Merge with Wikipedia sources for breadth
      if (wikiSources.length > 0) {
        const merged = [...(r.sources || []), ...wikiSources];
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
      console.log(`[cw-slides-v3] phase1 OK '${topic.topic_title.slice(0, 60)}': ${r.sources.length} sources, ${r.key_statistics?.length || 0} stats`);
      return r;
    }
    console.warn(`[cw-slides-v3] phase1 synth returned 0 sources for '${topic.topic_title.slice(0, 60)}'`);
  } catch (e: any) {
    console.error(`[cw-slides-v3] phase1 Messages API FAILED for '${topic.topic_title.slice(0, 60)}': ${e?.message?.slice(0, 250)} | status=${e?.status || '?'}`);
  }

  // ── Failure path: return raw HTTP/Wiki sources without synthesis ──────
  // This is NOT a generic fallback — it's still real per-topic data from
  // the internet search. Phase 2 can still build on-topic blocks from it.
  const rawSources = [
    ...webResults.slice(0, 5).map((w) => ({
      url: w.url,
      title: w.title,
      type: 'article' as const,
      key_findings: [w.snippet.slice(0, 200)].filter((s) => s.length > 10),
      relevance_score: 0.7,
      date: '',
    })),
    ...wikiSources,
  ].slice(0, 6);

  return {
    topic: topic.topic_title,
    sources: rawSources,
    summary: webResults.slice(0, 3).map((w) => w.snippet).join(' ').slice(0, 800),
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
  _model?: string,
): Promise<Record<string, ResearchEntry>> {
  if (topics.length === 0) return {};
  const tasks = topics.map((t) => () => researchTopic(t, courseTitle, apiKey));
  const results = await runWithConcurrency(tasks, RESEARCH_CONCURRENCY);
  const map: Record<string, ResearchEntry> = {};
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    if (r instanceof Error) {
      console.error(`[cw-slides-v3] phase1 task threw for '${key.slice(0, 60)}':`, r.message);
      map[key] = { topic: key, sources: [], summary: '' };
    } else {
      map[key] = r;
    }
  });
  const totalSources = Object.values(map).reduce((n, e) => n + (e.sources?.length || 0), 0);
  console.log(`[cw-slides-v3] Phase 1 complete: ${Object.keys(map).length} topics, ${totalSources} total sources`);
  return map;
}
