/**
 * Phase 2 — Content Generator.
 *
 * Mirrors Streamlit `courseware_agents/slides/content_generator_agent.py`:
 *   - Single Claude call per topic with maxTurns=5
 *   - Output: structured content blocks with viz_type / data.items / caption
 *   - ALWAYS pads to target count using cycled stub templates (Streamlit
 *     _pad_content_blocks). Guarantees deck size matches duration target.
 *
 * Caption derived from research sources; if empty, leaves blank (NEVER
 * uses fake-source pool — that pattern produced same 3 generic strings
 * repeating across every slide in production).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import { CONTENT_SYSTEM_PROMPT } from './prompts';
import type {
  ContentBlock,
  ContentBlockItem,
  ContentMapEntry,
  ResearchEntry,
  SlideTopic,
} from './types';

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const CONTENT_MAX_TURNS = 5;

// ────────────────────────────────────────────────────────────────────────────
// Claude SDK helper
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
  const { prompt, systemPrompt, tools = [], maxTurns = CONTENT_MAX_TURNS, model, apiKey } = opts;
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

async function runWithConcurrency<T>(items: Array<() => Promise<T>>, concurrency: number): Promise<Array<T | Error>> {
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
// Caption helper — Streamlit-style "Source: <name>, <year>"
// ────────────────────────────────────────────────────────────────────────────

function captionFromResearch(research: ResearchEntry | undefined): string {
  const sources = research?.sources ?? [];
  const named = sources
    .map((s) => {
      const title = String(s?.title ?? '').trim();
      const year = String(s?.date ?? '').trim();
      if (!title) return '';
      const clean = title.replace(/[.;:,!?]+$/, '').slice(0, 40);
      return year ? `${clean}, ${year}` : clean;
    })
    .filter(Boolean)
    .slice(0, 3);
  if (named.length) return `Source: ${named.join('; ')}`;
  return ''; // empty caption when no research — NO fake-source pool
}

// ────────────────────────────────────────────────────────────────────────────
// Padding — Streamlit _pad_content_blocks ported verbatim
// ────────────────────────────────────────────────────────────────────────────

const PAD_TEMPLATES: Array<[string, string]> = [
  ['overview', 'list-grid-badge-card'],
  ['process', 'sequence-snake-steps-compact-card'],
  ['comparison', 'compare-binary-horizontal-badge-card-arrow'],
  ['overview', 'list-grid-candy-card-lite'],
  ['statistics', 'chart-pie-compact-card'],
  ['hierarchy', 'hierarchy-tree-curved-line-rounded-rect-node'],
  ['overview', 'list-zigzag-down-compact-card'],
  ['timeline', 'sequence-timeline-simple'],
  ['overview', 'list-grid-ribbon-card'],
  ['process', 'sequence-stairs-front-pill-badge'],
  ['statistics', 'chart-bar-plain-text'],
  ['overview', 'list-zigzag-up-compact-card'],
  ['cycle', 'sequence-pyramid-simple'],
  ['overview', 'list-row-horizontal-icon-arrow'],
  ['quadrant', 'quadrant-quarter-simple-card'],
  ['relationship', 'relation-circle-icon-badge'],
];

export function padContentBlocks(
  existing: ContentBlock[],
  topicTitle: string,
  bullets: string[] = [],
  target = 6,
): ContentBlock[] {
  if (existing.length >= target) return existing.slice(0, target);
  const blocks: ContentBlock[] = [...existing];
  const bps = bullets.filter((b) => String(b ?? '').trim().length >= 10);

  let padIdx = 0;
  while (blocks.length < target) {
    const bi = blocks.length;
    let [vizType, template] = PAD_TEMPLATES[padIdx % PAD_TEMPLATES.length];
    padIdx++;

    // Avoid back-to-back duplicate viz types
    if (blocks.length && blocks[blocks.length - 1].visualization_type === vizType) {
      [vizType, template] = PAD_TEMPLATES[padIdx % PAD_TEMPLATES.length];
      padIdx++;
    }

    const bpStart = bi * 2;
    const bpChunk = bpStart < bps.length ? bps.slice(bpStart, bpStart + 4) : [];

    let items: ContentBlockItem[];
    if (vizType === 'comparison') {
      items = [
        { label: 'Traditional', desc: `Traditional approach to ${topicTitle}`, icon: 'mdi/history' },
        { label: 'Modern', desc: `Modern approach to ${topicTitle}`, icon: 'mdi/rocket-launch' },
      ];
    } else if (vizType === 'statistics') {
      items = [
        { label: 'Adoption', value: 73, desc: 'Industry adoption rate', icon: 'mdi/trending-up' },
        { label: 'Efficiency', value: 45, desc: 'Efficiency improvement', icon: 'mdi/chart-line' },
        { label: 'Cost Save', value: 30, desc: 'Cost reduction', icon: 'mdi/currency-usd' },
      ];
    } else if (bpChunk.length) {
      items = bpChunk.map((bp) => ({
        label: bp.split(' ').slice(0, 3).join(' ').slice(0, 28),
        desc: bp,
        icon: 'mdi/chevron-right',
      }));
    } else {
      items = Array.from({ length: 4 }, (_, j) => ({
        label: `Point ${j + 1}`,
        desc: `Key aspect ${j + 1} of ${topicTitle}`,
        icon: 'mdi/information',
      }));
    }

    const subTitle = bpChunk.length
      ? bpChunk[0].split(' ').slice(0, 6).join(' ').slice(0, 60)
      : `${topicTitle} — Detail ${bi}`;

    blocks.push({
      block_index: bi,
      sub_title: subTitle || `${topicTitle} — Key Concepts`,
      visualization_type: vizType,
      suggested_template: template,
      data: {
        title: subTitle.slice(0, 30) || topicTitle,
        desc: `Key aspects of ${topicTitle}`,
        items,
      },
      caption: '',
      sources_used: [],
    });
  }

  // Always make the last block a "Key Takeaways" overview (matches Streamlit)
  if (blocks.length && blocks[blocks.length - 1].visualization_type !== 'overview') {
    const last = blocks[blocks.length - 1];
    last.visualization_type = 'overview';
    last.suggested_template = 'list-grid-badge-card';
    last.sub_title = 'Key Takeaways';
    if (last.data) last.data.title = `${topicTitle} — Key Takeaways`;
  }

  return blocks.slice(0, target);
}

// ────────────────────────────────────────────────────────────────────────────
// Per-topic content generation
// ────────────────────────────────────────────────────────────────────────────

async function generateTopicContent(
  topic: SlideTopic,
  research: ResearchEntry,
  courseTitle: string,
  numBlocks: number,
  apiKey: string,
  model?: string,
): Promise<ContentMapEntry> {
  // Build research-context block for the prompt
  let researchText = '';
  const sources = research?.sources ?? [];
  if (research) {
    if (research.summary) researchText += `\nRESEARCH SUMMARY:\n${research.summary}\n`;
    if (sources.length) {
      researchText += `\nTOP SOURCES (${sources.length}):\n`;
      for (const s of sources.slice(0, 12)) {
        const findings = (s.key_findings || []).slice(0, 3).join('; ');
        researchText += `  - ${s.title || ''} (${s.date || ''}): ${findings}\n`;
      }
    }
    const stats = research.key_statistics || [];
    if (stats.length) {
      researchText += '\nSTATISTICS:\n';
      for (const st of stats.slice(0, 8)) researchText += `  - ${st.stat} — ${st.source || ''}\n`;
    }
    const info = research.infographic_data || {};
    if (info.chart_data?.length) {
      researchText += '\nCHART-READY DATA:\n';
      for (const cd of info.chart_data.slice(0, 6)) researchText += `  - ${cd.label}: ${cd.value} (${cd.source || ''})\n`;
    }
    if (info.process_steps?.length) {
      researchText += '\nPROCESS STEPS:\n' + info.process_steps.slice(0, 6).map((p) => `  - ${p}`).join('\n') + '\n';
    }
    if (info.comparison_items?.length) {
      researchText += '\nCOMPARISON DATA:\n' + info.comparison_items.map((c) => `  - ${c.label}: ${c.desc}`).join('\n') + '\n';
    }
  }

  const bpText = topic.bullet_points?.length
    ? '\nCP BULLET POINTS:\n' + topic.bullet_points.slice(0, 10).map((b) => `  - ${b}`).join('\n')
    : '';

  const researchHint = sources.length < 2
    ? `\nNOTE: Research data is thin (${sources.length} sources). Use WebSearch (1 search max) to find supplementary facts.`
    : '';

  const prompt = `Create ${numBlocks} content blocks for this topic. Each block = one infographic slide.

COURSE: ${courseTitle}
LEARNING UNIT: ${topic.lu_title}
LEARNING OUTCOME: ${topic.lo_description}
TOPIC: ${topic.topic_title}
${bpText}
${researchText}
${researchHint}

Return this JSON:
{
  "topic": "${topic.topic_title}",
  "content_blocks": [
    {
      "block_index": 0,
      "sub_title": "What is ${topic.topic_title}?",
      "visualization_type": "overview",
      "suggested_template": "list-grid-badge-card",
      "data": {
        "title": "Short Title (3-6 words)",
        "desc": "Brief one-line overview (max 8 words)",
        "items": [
          {"label": "Key Point", "desc": "Short complete phrase (4-8 words)", "icon": "mdi/icon-name"}
        ]
      },
      "caption": "Source: Name, Year",
      "sources_used": ["Source Name"]
    }
    /* ${numBlocks} blocks total, VARY visualization_type, varied content-specific icons */
  ],
  "activity": {
    "title": "Exercise Name",
    "scenario": "Real-world scenario description",
    "steps": ["Step 1: Action", "Step 2: Action", "Step 3: Action"],
    "expected_output": "What learners produce",
    "duration": "20 minutes"
  }
}

MANDATORY BLOCK SEQUENCE:
1. Block 0: "overview" — introduce the topic
2. Block 1..${numBlocks - 2}: VARY types (process / comparison / statistics / hierarchy / timeline / cycle)
3. Block ${numBlocks - 1}: "overview" — key takeaways summary

RULES:
- EXACTLY ${numBlocks} content blocks
- Labels: 2-3 words MAX (no "Pros"/"Cons" etc — name the actual concept)
- Descriptions: SHORT complete phrase, 4-8 words
- For "comparison": exactly 2 root items with children
- For "statistics": items MUST have numeric "value" field
- Include citations "(Source, Year)" in captions
- EVERY item must have a content-specific icon (varied across items)
`;

  const tools = sources.length < 2 ? ['WebSearch'] : [];

  try {
    const result = await runAgentJson({
      prompt,
      systemPrompt: CONTENT_SYSTEM_PROMPT,
      tools,
      maxTurns: CONTENT_MAX_TURNS,
      model: model || FAST_MODEL,
      apiKey,
    });
    let blocks: ContentBlock[] = Array.isArray(result?.content_blocks) ? result.content_blocks : [];

    // Always pad to target — Streamlit _pad_content_blocks behaviour
    if (blocks.length < numBlocks) {
      console.log(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}': model returned ${blocks.length}, padding to ${numBlocks}`);
      blocks = padContentBlocks(blocks, topic.topic_title, topic.bullet_points, numBlocks);
    } else {
      blocks = blocks.slice(0, numBlocks);
    }

    // Apply research-derived caption to blocks that lack one
    const baseCaption = captionFromResearch(research);
    for (const b of blocks) {
      if (!b.caption || b.caption.trim().length === 0) {
        b.caption = baseCaption;
      }
    }

    return {
      topic: topic.topic_title,
      content_blocks: blocks,
      activity: result?.activity,
    };
  } catch (e: any) {
    console.error(`[cw-slides-v2] content generation failed for '${topic.topic_title.slice(0, 60)}':`, e.message);
    // Pad from scratch — guarantees target count even when Claude call fails
    const padded = padContentBlocks([], topic.topic_title, topic.bullet_points, numBlocks);
    const baseCaption = captionFromResearch(research);
    for (const b of padded) {
      if (!b.caption) b.caption = baseCaption;
    }
    return {
      topic: topic.topic_title,
      content_blocks: padded,
      activity: {
        title: `${topic.topic_title} Practice`,
        scenario: `Apply ${topic.topic_title} concepts to a real scenario`,
        steps: ['Step 1: Review concepts', 'Step 2: Apply to scenario', 'Step 3: Discuss findings'],
        expected_output: 'Summary document',
        duration: '20 minutes',
      },
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public — generate content for all topics in parallel
// ────────────────────────────────────────────────────────────────────────────

export async function generateAllContent(
  topics: SlideTopic[],
  researchMap: Record<string, ResearchEntry>,
  perTopicBlocks: number[],
  courseTitle: string,
  apiKey: string,
  model?: string,
): Promise<Record<string, ContentMapEntry>> {
  const tasks = topics.map((t, i) => () => generateTopicContent(
    t,
    researchMap[t.topic_title] ?? { topic: t.topic_title, sources: [] },
    courseTitle,
    perTopicBlocks[i] || 6,
    apiKey,
    model,
  ));
  const results = await runWithConcurrency(tasks, 5);
  const map: Record<string, ContentMapEntry> = {};
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    if (r instanceof Error) {
      console.error(`[cw-slides-v2] content errored for '${key.slice(0, 60)}':`, r.message);
      map[key] = { topic: key, content_blocks: padContentBlocks([], key, topics[i].bullet_points, perTopicBlocks[i] || 6) };
    } else {
      map[key] = r;
    }
  });
  return map;
}
