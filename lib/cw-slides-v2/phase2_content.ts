/**
 * Phase 2 — Content Generator (TS port of Streamlit's content_generator_agent.py).
 *
 * SINGLE Claude call per topic, asking for all N blocks at once. This is
 * the exact pattern that produces Streamlit-reference-quality decks.
 * Iterative batching (4 blocks per call × 5 calls/topic) was tried in
 * earlier revisions but failed silently in production — every batch
 * returned 0 blocks, leaving every slide as padded placeholder. Single
 * call with maxTurns=5 and Haiku 3.5 (FAST_MODEL) is the proven shape.
 *
 * If the AI returns fewer than the target block count, we PAD with
 * CP-bullet-derived blocks (mirroring Streamlit's `_pad_content_blocks`).
 * If the AI throws (auth/network), we FALLBACK with bullet-only blocks
 * (mirroring Streamlit's `_fallback_content_blocks`). NEITHER path uses
 * Wikipedia article sentences — those produced the off-topic ChatGPT
 * facts users complained about in deck 21.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import { CONTENT_SYSTEM_PROMPT } from './prompts';
import type {
  ActivityData,
  ContentBlock,
  ContentBlockItem,
  ContentMapEntry,
  ResearchEntry,
  SlideTopic,
} from './types';

// Streamlit's reference uses claude-3-5-haiku-20241022 — this model is
// the most reliable for short JSON outputs in production. Haiku 4.5
// (newer) was rejecting roughly half the prompts in the Coolify
// container. Stick with Haiku 3.5 to match Streamlit.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const CONTENT_MAX_TURNS = 5;
const CONCURRENCY = 5;

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
// Caption — "Source: <name>, <year>" from research sources
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
  return '';
}

// ────────────────────────────────────────────────────────────────────────────
// Streamlit-faithful padding (CP bullets, not Wikipedia sentences)
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

/**
 * Pad existing AI-generated blocks up to `target` count using CP bullet
 * points and varied visualization types. Mirrors Streamlit's
 * `_pad_content_blocks` line-for-line.
 */
export function padContentBlocks(
  existing: ContentBlock[],
  topicTitle: string,
  bulletPoints: string[] = [],
  target = 6,
): ContentBlock[] {
  if (existing.length >= target) return existing.slice(0, target);

  const bps = (bulletPoints || []).filter((b) => String(b ?? '').trim().length > 0);
  const blocks: ContentBlock[] = [...existing];
  let padIdx = 0;

  while (blocks.length < target) {
    const bi = blocks.length;
    let [vizType, template] = PAD_TEMPLATES[padIdx % PAD_TEMPLATES.length];
    padIdx++;
    // Don't repeat the previous block's viz type
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
        label: bp.split(/[\s,;:]+/).slice(0, 3).join(' ').slice(0, 28) || bp.slice(0, 28),
        desc: bp.slice(0, 80),
        icon: 'mdi/chevron-right',
      }));
    } else {
      items = Array.from({ length: 4 }, (_, j) => ({
        label: `Point ${j + 1}`,
        desc: `Key aspect ${j + 1} of ${topicTitle}`,
        icon: 'mdi/information',
      }));
    }

    const subTitle = bpChunk.length ? bpChunk[0].slice(0, 35) : `${topicTitle} — Detail ${bi}`;

    blocks.push({
      block_index: bi,
      sub_title: subTitle,
      visualization_type: vizType,
      suggested_template: template,
      data: {
        title: subTitle.slice(0, 30),
        desc: `Key aspects of ${topicTitle}`,
        items,
      },
      caption: '',
      sources_used: [],
    });
  }

  // Ensure the last block is always overview-styled "Key Takeaways"
  if (blocks.length && blocks[blocks.length - 1].visualization_type !== 'overview') {
    const last = blocks[blocks.length - 1];
    last.visualization_type = 'overview';
    last.suggested_template = 'list-grid-badge-card';
    last.sub_title = 'Key Takeaways';
    if (last.data) last.data.title = `${topicTitle} — Key Takeaways`;
  }

  return blocks.slice(0, target);
}

/**
 * Generate simple content blocks from CP bullet points only (used when
 * the AI call throws). Mirrors Streamlit's `_fallback_content_blocks`.
 */
function fallbackContentBlocks(
  topicTitle: string,
  bulletPoints: string[] = [],
  numBlocks = 6,
): ContentMapEntry {
  const bps = bulletPoints.length ? bulletPoints : [topicTitle];
  const chunkSize = Math.max(1, Math.floor(bps.length / Math.max(1, numBlocks - 1)));
  const blocks: ContentBlock[] = [];

  blocks.push({
    block_index: 0,
    sub_title: `What is ${topicTitle}?`,
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: {
      title: topicTitle.slice(0, 40),
      desc: `Key concepts of ${topicTitle}`,
      items: bps.slice(0, 6).map((bp) => ({
        label: bp.split(/[\s,;:]+/).slice(0, 3).join(' ').slice(0, 25),
        desc: bp.slice(0, 80),
        icon: 'mdi/information',
      })),
    },
    caption: '',
    sources_used: [],
  });

  for (let i = 1; i < numBlocks - 1; i++) {
    const start = (i - 1) * chunkSize;
    const chunk = bps.slice(start, start + chunkSize);
    if (chunk.length === 0) chunk.push(`Detail ${i}`);
    blocks.push({
      block_index: i,
      sub_title: chunk[0].slice(0, 35),
      visualization_type: 'overview',
      suggested_template: 'list-row-horizontal-icon-arrow',
      data: {
        title: chunk[0].slice(0, 30),
        items: chunk.map((c) => ({
          label: c.split(/[\s,;:]+/).slice(0, 3).join(' ').slice(0, 25),
          desc: c.slice(0, 80),
          icon: 'mdi/chevron-right',
        })),
      },
      caption: '',
      sources_used: [],
    });
  }

  blocks.push({
    block_index: numBlocks - 1,
    sub_title: 'Key Takeaways',
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: {
      title: `${topicTitle} — Key Takeaways`,
      items: bps.slice(0, 4).map((bp) => ({
        label: bp.split(/[\s,;:]+/).slice(0, 3).join(' ').slice(0, 25),
        desc: bp.slice(0, 80),
        icon: 'mdi/star',
      })),
    },
    caption: '',
    sources_used: [],
  });

  return {
    topic: topicTitle,
    content_blocks: blocks.slice(0, numBlocks),
    activity: {
      title: `${topicTitle} Practice`,
      scenario: `Apply ${topicTitle} concepts in a workplace scenario`,
      steps: [
        'Step 1: Review the concepts from this topic',
        'Step 2: Apply them to a realistic scenario',
        'Step 3: Discuss outcomes and document learnings',
      ],
      expected_output: 'A short summary of the applied scenario and key insights',
      duration: '20 minutes',
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Single-call content generation per topic (Streamlit-faithful)
// ────────────────────────────────────────────────────────────────────────────

async function generateTopicContent(
  topic: SlideTopic,
  research: ResearchEntry,
  courseTitle: string,
  numBlocks: number,
  apiKey: string,
  model?: string,
): Promise<ContentMapEntry> {
  // Build research context
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
    ? `\nNOTE: Research data is thin (${sources.length} sources). Use WebSearch to find 1-2 supplementary sources about "${topic.topic_title}" to enrich the blocks. Keep searches focused — 1 search max.`
    : '';

  // Streamlit's prompt — ported verbatim with template substitutions.
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
        "title": "Short Title Here (3-6 words)",
        "desc": "Brief one-line overview (max 8 words)",
        "items": [
          {"label": "Key Point", "desc": "Short complete phrase (4-8 words)", "icon": "mdi/icon-name"},
          {"label": "Framework", "desc": "Another short complete phrase", "icon": "mdi/icon-name"},
          {"label": "Best Practice", "desc": "Concise actionable description", "icon": "mdi/icon-name"},
          {"label": "Assessment", "desc": "Clear measurable outcome", "icon": "mdi/icon-name"}
        ]
      },
      "caption": "Source: Name, Year",
      "sources_used": ["Source Name"]
    }
    /* ${numBlocks} blocks total — VARY visualization_type across blocks */
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
1. Block 0: "overview" — introduce the topic (list-grid or list-row template)
2. Block 1-${numBlocks - 2}: VARY types — use process, comparison, statistics, hierarchy, timeline
3. Block ${numBlocks - 1}: "overview" — key takeaways summary

RULES:
- EXACTLY ${numBlocks} content blocks
- Labels: 2-3 words MAX (e.g. "Risk Assessment", "Data Security")
- Descriptions: SHORT complete phrase, 4-8 words (e.g. "Systematic approach to compliance management")
- Title: 3-6 words, Desc: max 8 words — these appear on INFOGRAPHIC IMAGES with limited space
- NEVER write long sentences — every description must be a SHORT, COMPLETE phrase
- For "comparison": exactly 2 root items with children
- For "statistics": items MUST have numeric "value" field
- Include citations "(Source, Year)" in captions
- Include at least 1 statistics block if research has numbers`;

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
    const types = blocks.map((b) => b.visualization_type).join(', ');
    console.log(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}': ${blocks.length}/${numBlocks} blocks, types: [${types}]`);

    // ENFORCE exact count — pad with CP bullets if AI returned fewer
    if (blocks.length < numBlocks) {
      console.warn(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}': AI produced ${blocks.length} blocks, padding to ${numBlocks}`);
      blocks = padContentBlocks(blocks, topic.topic_title, topic.bullet_points, numBlocks);
    } else {
      blocks = blocks.slice(0, numBlocks);
    }

    // Always force last block to be Key Takeaways
    if (blocks.length > 0 && blocks[blocks.length - 1].visualization_type !== 'overview') {
      const last = blocks[blocks.length - 1];
      last.visualization_type = 'overview';
      last.suggested_template = 'list-grid-badge-card';
      last.sub_title = 'Key Takeaways';
      if (last.data) last.data.title = `${topic.topic_title} — Key Takeaways`;
    }

    // Apply research-derived caption to blocks that lack one
    const baseCaption = captionFromResearch(research);
    for (const b of blocks) {
      if (!b.caption || b.caption.trim().length === 0) b.caption = baseCaption;
    }

    return {
      topic: topic.topic_title,
      content_blocks: blocks,
      activity: result.activity as ActivityData | undefined,
    };
  } catch (e: any) {
    console.error(`[cw-slides-v2] content gen FAILED for '${topic.topic_title.slice(0, 60)}': ${e.message?.slice(0, 200)}`);
    return fallbackContentBlocks(topic.topic_title, topic.bullet_points, numBlocks);
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
  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const map: Record<string, ContentMapEntry> = {};
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    if (r instanceof Error) {
      console.error(`[cw-slides-v2] content errored for '${key.slice(0, 60)}':`, r.message);
      map[key] = fallbackContentBlocks(key, topics[i].bullet_points, perTopicBlocks[i] || 6);
    } else {
      map[key] = r;
    }
  });
  const totalBlocks = Object.values(map).reduce((n, c) => n + c.content_blocks.length, 0);
  const target = perTopicBlocks.reduce((a, b) => a + b, 0);
  console.log(`[cw-slides-v2] Phase 2 complete: ${totalBlocks}/${target} blocks across ${Object.keys(map).length} topics`);
  return map;
}
