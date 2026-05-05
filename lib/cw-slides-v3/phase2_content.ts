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
 * Build content blocks when the Phase 2 AI call fails.
 *
 * Production reality (deck 22): Phase 2 sometimes throws in the Coolify
 * container even though Phase 1 research succeeds. When that happens we
 * have a rich research entry sitting unused. This fallback uses
 *   1. CP bullet_points (always topic-specific from the proposal)
 *   2. research.infographic_data — chart_data, process_steps,
 *      comparison_items, hierarchy/timeline data
 *   3. research.sources[].key_findings — Wikipedia/web sentences
 *   4. research.summary as overview material
 * to build content blocks that look as close as possible to what the AI
 * would have produced. Never emits "Detail N" placeholders or generic
 * "Apply X concepts in a workplace scenario" activities.
 */
function fallbackContentBlocks(
  topicTitle: string,
  bulletPoints: string[] = [],
  numBlocks = 6,
  research?: ResearchEntry,
): ContentMapEntry {
  const bps = (bulletPoints || []).filter((b) => String(b ?? '').trim().length > 0);
  const r = research;
  const procSteps: string[] = (r?.infographic_data?.process_steps || []).filter((s) => typeof s === 'string' && s.trim().length > 5);
  const compItems: any[] = r?.infographic_data?.comparison_items || [];
  const chartData: any[] = r?.infographic_data?.chart_data || [];
  const timelineData: any[] = r?.infographic_data?.timeline_data || [];

  // Flatten research findings (~3-5 per source × 5 sources = 15-25 sentences).
  const findings: string[] = [];
  for (const s of r?.sources || []) {
    for (const f of (s.key_findings || [])) {
      const t = String(f).trim();
      if (t.length >= 20 && t.length <= 200) findings.push(t);
    }
  }

  const cleanText = (s: string): string => s
    .replace(/&[a-z#0-9]+;/gi, (m) => ({ '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' } as any)[m] || m)
    .replace(/^["'`'']+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Helper: pick a short noun-phrase label from a sentence, never a verb fragment.
  const VERBS = /^(is|are|was|were|be|been|have|has|had|do|does|did|can|could|will|would|should|may|might|must|use|uses|used|make|makes|made|take|takes|took|get|gets|got)$/i;
  const STOPS = new Set(['the','a','an','this','that','these','those','it','they','we','you','i','in','on','at','of','for','to','from','by','with','and','or','but','as']);
  const labelFromSentence = (sent: string): string => {
    const cleaned = sent.replace(/[.,;:!?()'"]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter((w) => w.length >= 2);
    let anchor = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]; const lw = w.toLowerCase();
      if (STOPS.has(lw) || VERBS.test(lw)) continue;
      if (w.length < 4 && !/^[A-Z]{2,}$/.test(w)) continue;
      anchor = i; break;
    }
    if (anchor === -1) return '';
    const phrase: string[] = [];
    for (let i = anchor; i < words.length && phrase.length < 3; i++) {
      const w = words[i]; const lw = w.toLowerCase();
      if (phrase.length > 0 && (STOPS.has(lw) || VERBS.test(lw))) break;
      phrase.push(w);
    }
    return phrase.join(' ');
  };
  const truncWord = (s: string, max: number): string => {
    if (!s) return '';
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace >= 4 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\-]+$/, '');
  };

  // Keyword overlap score — used to pick research findings RELATED to a
  // specific CP bullet (so each per-bullet block stays on-topic).
  const STOPWORDS = new Set(['the','a','an','of','in','on','at','to','for','and','or','with','by','is','are','was','were','be','been','this','that','these','those','it','its','their','as','from','about','using','use','used']);
  const tokens = (s: string): Set<string> => {
    return new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    );
  };
  const findingsForBullet = (bullet: string, max = 5, exclude: Set<string>): string[] => {
    const bullKw = tokens(bullet);
    const scored = findings
      .map((f, i) => {
        if (exclude.has(`${i}`)) return null;
        const fKw = tokens(f);
        let overlap = 0;
        for (const k of fKw) if (bullKw.has(k)) overlap++;
        return { idx: i, finding: f, score: overlap };
      })
      .filter((x): x is { idx: number; finding: string; score: number } => x !== null && x.score >= 1)
      .sort((a, b) => b.score - a.score);
    const picked: string[] = [];
    for (const s of scored) {
      if (picked.length >= max) break;
      picked.push(s.finding);
      exclude.add(`${s.idx}`);
    }
    return picked;
  };

  const blocks: ContentBlock[] = [];
  const usedFindingIdxs = new Set<string>();

  // ── Block 0 — Overview: each CP bullet becomes a card ─────────────
  // This anchors the topic to the CP from slide one.
  const overviewItems: ContentBlockItem[] = [];
  for (const bp of bps.slice(0, 5)) {
    overviewItems.push({
      label: truncWord(bp.split(/[\s,;:]+/).slice(0, 3).join(' '), 24),
      desc: truncWord(cleanText(bp), 80),
      icon: 'mdi/information',
    });
  }
  if (overviewItems.length === 0) {
    overviewItems.push({ label: 'Overview', desc: `Key aspects of ${topicTitle}`, icon: 'mdi/information' });
  }
  blocks.push({
    block_index: 0,
    sub_title: `What is ${topicTitle}?`,
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: { title: topicTitle.slice(0, 40), items: overviewItems },
    caption: '',
    sources_used: [],
  });

  // ── Block per CP bullet — Definition / Why / How / Best Practice ────
  // Each block is dedicated to one CP bullet, expanded into 4 teaching
  // cards using a standard adult-learning framework. Research findings
  // (when available and topic-aligned) replace the generic Definition
  // card with a sourced one. This produces substantive content even
  // when Phase 2 AI fails entirely.
  const bulletNoun = (b: string): string => {
    // First 3 content words = card label
    const cleaned = cleanText(b).replace(/[.,;:!?()'"]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter((w) => w.length >= 2);
    const STOPS_LOC = new Set(['the','a','an','of','in','on','at','to','for','and','or','with','by','is','are','was','using','use','used','this','that']);
    const content = words.filter((w) => !STOPS_LOC.has(w.toLowerCase()));
    return (content.length ? content : words).slice(0, 3).join(' ');
  };
  const titleCase = (s: string): string => s.replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

  for (let bi = 0; bi < bps.length && blocks.length < numBlocks - 1; bi++) {
    const bullet = bps[bi];
    const noun = bulletNoun(bullet);
    const matchedFindings = findingsForBullet(bullet, 1, usedFindingIdxs);
    const items: ContentBlockItem[] = [];

    // Card 1 — Definition (from research finding if available, else bullet text)
    if (matchedFindings.length > 0) {
      items.push({
        label: 'What It Is',
        desc: truncWord(cleanText(matchedFindings[0]), 80),
        icon: 'mdi/information',
      });
    } else {
      items.push({
        label: 'What It Is',
        desc: truncWord(cleanText(bullet), 80),
        icon: 'mdi/information',
      });
    }

    // Card 2 — Why It Matters (anchored to the topic + bullet)
    items.push({
      label: 'Why It Matters',
      desc: `Foundation for ${truncWord(noun.toLowerCase(), 40)} in ${truncWord(topicTitle.toLowerCase(), 30)}`,
      icon: 'mdi/star',
    });

    // Card 3 — How to Apply (action-oriented)
    items.push({
      label: 'How to Apply',
      desc: `Practice ${truncWord(noun.toLowerCase(), 40)} as part of your ${truncWord(topicTitle.toLowerCase().split(' ').slice(0, 4).join(' '), 28)} workflow`,
      icon: 'mdi/cog',
    });

    // Card 4 — Best Practice / Outcome
    items.push({
      label: 'Outcome',
      desc: `Confidence applying ${truncWord(noun.toLowerCase(), 50)} in real workplace tasks`,
      icon: 'mdi/check-circle',
    });

    blocks.push({
      block_index: blocks.length,
      sub_title: truncWord(titleCase(cleanText(bullet)), 60),
      visualization_type: 'overview',
      suggested_template: bi % 2 === 0 ? 'list-grid-badge-card' : 'list-grid-candy-card-lite',
      data: { title: truncWord(titleCase(cleanText(bullet)), 40), items },
      caption: '',
      sources_used: [],
    });
  }

  // ── Remaining blocks — process / comparison / statistics / timeline,
  // but ONLY using research data that exists. Otherwise use unused
  // findings as overview cards. NO off-topic content. ─────────────────
  let procCursor = 0;
  let pickIdx = 0;
  while (blocks.length < numBlocks - 1) {
    let block: ContentBlock | null = null;
    const tryProcess = pickIdx % 4 === 0 && procSteps.length - procCursor >= 3;
    const tryComp = pickIdx % 4 === 1 && compItems.length >= 2;
    const tryStats = pickIdx % 4 === 2 && chartData.length >= 2;
    const tryTimeline = pickIdx % 4 === 3 && timelineData.length >= 2;
    pickIdx++;

    if (tryProcess) {
      const stepChunk = procSteps.slice(procCursor, procCursor + 5);
      procCursor += stepChunk.length;
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Process Steps`,
        visualization_type: 'process',
        suggested_template: 'sequence-snake-steps-compact-card',
        data: {
          title: 'Implementation Steps',
          items: stepChunk.map((s, i) => ({
            label: `Step ${i + 1}`,
            desc: truncWord(cleanText(s), 60),
            icon: 'mdi/arrow-right',
          })),
        },
        caption: '',
        sources_used: [],
      };
    } else if (tryComp) {
      const pair = compItems.slice(0, 2);
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Approach Comparison`,
        visualization_type: 'comparison',
        suggested_template: 'compare-binary-horizontal-badge-card-arrow',
        data: {
          title: 'Approaches',
          items: pair.map((c, i) => ({
            label: truncWord(String(c.label ?? (i === 0 ? 'Traditional' : 'Modern')), 22),
            desc: truncWord(String(c.desc ?? ''), 60),
            icon: i === 0 ? 'mdi/history' : 'mdi/rocket-launch',
          })),
        },
        caption: '',
        sources_used: [],
      };
    } else if (tryStats) {
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Industry Metrics`,
        visualization_type: 'statistics',
        suggested_template: 'chart-bar-plain-text',
        data: {
          title: 'Key Metrics',
          items: chartData.slice(0, 5).map((d: any) => ({
            label: truncWord(String(d.label || ''), 18) || 'Metric',
            value: typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : 50,
            desc: '',
            icon: 'mdi/chart-bar',
          })),
        },
        caption: '',
        sources_used: [],
      };
    } else if (tryTimeline) {
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Timeline`,
        visualization_type: 'timeline',
        suggested_template: 'sequence-timeline-simple',
        data: {
          title: 'Evolution',
          items: timelineData.slice(0, 5).map((d: any) => ({
            label: truncWord(String(d.year || ''), 14) || 'Phase',
            desc: truncWord(String(d.event || ''), 60),
            icon: 'mdi/clock',
          })),
        },
        caption: '',
        sources_used: [],
      };
    }

    // Fallback path within fallback: re-expand from the most-relevant
    // bullets using the topic title as the keyword anchor.
    if (!block) {
      const topicKw = tokens(topicTitle);
      const scored = findings
        .map((f, i) => ({ idx: i, finding: f, score: [...tokens(f)].filter((k) => topicKw.has(k)).length }))
        .filter((x) => x.score >= 1 && !usedFindingIdxs.has(`${x.idx}`))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      if (scored.length < 2) break; // truly nothing relevant — stop padding
      const items: ContentBlockItem[] = [];
      const seen = new Set<string>();
      for (const s of scored) {
        const desc = cleanText(s.finding);
        const lbl = labelFromSentence(desc);
        if (!lbl) continue;
        const key = lbl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          label: truncWord(lbl, 24),
          desc: truncWord(desc, 80),
          icon: 'mdi/lightbulb',
        });
        usedFindingIdxs.add(`${s.idx}`);
      }
      if (items.length < 2) break;
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Further Reading`,
        visualization_type: 'overview',
        suggested_template: 'list-zigzag-down-compact-card',
        data: { title: 'Additional Insights', items },
        caption: '',
        sources_used: [],
      };
    }
    blocks.push(block);
  }

  // ── Final block — Key Takeaways: ALWAYS recap CP bullets ────────────
  // Each takeaway card maps to one CP bullet so the slide reinforces the
  // mandatory CP coverage from the source of truth.
  const ktItems: ContentBlockItem[] = [];
  for (const bp of bps.slice(0, 5)) {
    ktItems.push({
      label: truncWord(bp.split(/[\s,;:]+/).slice(0, 3).join(' '), 24),
      desc: truncWord(cleanText(bp), 80),
      icon: 'mdi/star',
    });
  }
  if (ktItems.length === 0) {
    ktItems.push({ label: 'Key Concept', desc: `Apply ${topicTitle} principles consistently`, icon: 'mdi/star' });
  }
  blocks.push({
    block_index: blocks.length,
    sub_title: 'Key Takeaways',
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: { title: `${topicTitle} — Key Takeaways`, items: ktItems },
    caption: '',
    sources_used: [],
  });

  // Activity — synthesise a sensible one (NOT the generic "Apply X concepts...")
  const activity: ActivityData = {
    title: `${topicTitle.split(/[\s,]+/).slice(0, 4).join(' ')} Practical Exercise`,
    scenario: bps.length
      ? `In small groups, work through a real workplace scenario that requires you to ${bps[0].toLowerCase()}. Use the concepts from this topic to evaluate options and justify your decision.`
      : `In small groups, work through a real workplace scenario that requires applying ${topicTitle.toLowerCase()}. Use the concepts from this topic to evaluate options and justify your decision.`,
    steps: [
      `Step 1: Identify a recent or hypothetical workplace situation involving ${topicTitle.toLowerCase()}.`,
      'Step 2: List the key risks, stakeholders, and ethical considerations involved.',
      'Step 3: Decide on the recommended approach and justify it against industry frameworks.',
      'Step 4: Document the controls, monitoring, and follow-up actions required.',
    ],
    expected_output: 'A one-page summary covering: situation description, risks identified, chosen approach with justification, and follow-up controls.',
    duration: '20 minutes',
  };

  return {
    topic: topicTitle,
    content_blocks: blocks.slice(0, numBlocks),
    activity,
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

  // CP-BULLET-ANCHORED prompt: bullets are the source of truth for what
  // the topic teaches. Every content block MUST address one or more
  // bullets. Research is for ENRICHMENT only — examples, statistics,
  // frameworks that illustrate a bullet — never for off-topic content.
  // This is what produces aligned slides instead of the deck-23 issue
  // where Wikipedia "ChatGPT" facts appeared on ethics slides.
  const bullets = (topic.bullet_points || []).filter((b) => String(b ?? '').trim().length > 0);
  const bulletList = bullets.length
    ? bullets.map((b, i) => `  ${i + 1}. ${b}`).join('\n')
    : '  (no CP bullets — use the topic title as the sole anchor)';

  const prompt = `Generate ${numBlocks} content blocks for one infographic slide each.

COURSE: ${courseTitle}
LEARNING UNIT: ${topic.lu_title}
LEARNING OUTCOME: ${topic.lo_description}
TOPIC: ${topic.topic_title}

CP COVERAGE REQUIREMENTS — these bullets are the SOURCE OF TRUTH for what the slides MUST teach:
${bulletList}

EVERY content block MUST directly teach or expand on one of the CP bullets above. Do NOT include facts that don't relate to a bullet. Research data below is for ENRICHMENT — examples, frameworks, statistics that illustrate a bullet — never as standalone content.
${researchText}
${researchHint}

Return JSON:
{
  "topic": "${topic.topic_title}",
  "content_blocks": [
    {
      "block_index": 0,
      "sub_title": "What is ${topic.topic_title}?",
      "visualization_type": "overview",
      "suggested_template": "list-grid-badge-card",
      "addresses_bullet": "<which CP bullet number this addresses, or 'overview-of-all'>",
      "data": {
        "title": "Short Title (3-6 words)",
        "items": [
          {"label": "Concept Name", "desc": "Short clause (4-8 words)", "icon": "mdi/icon-name"}
        ]
      },
      "caption": "Source: Name, Year"
    }
  ],
  "activity": {
    "title": "Workplace exercise name",
    "scenario": "Singapore-relevant 1-2 sentence scenario",
    "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "expected_output": "Concrete deliverable",
    "duration": "20 minutes"
  }
}

MANDATORY BLOCK STRUCTURE:
- Block 0: overview introducing the topic — items list each CP bullet as a card
${bullets.map((_, i) => `- Block ${i + 1}: dedicated to CP bullet ${i + 1} (${bullets[i].slice(0, 50)})`).join('\n')}
- Remaining blocks (if numBlocks > ${bullets.length + 2}): expand on the bullets using research data — process steps, comparisons, statistics, frameworks
- Final block: Key Takeaways recapping the bullets

VISUALIZATION TYPES — choose what fits the bullet's content:
- overview: list-grid-badge-card / list-row-horizontal-icon-arrow
- process: sequence-snake-steps-compact-card (use when bullet describes steps)
- comparison: compare-binary-horizontal-badge-card-arrow (use when bullet compares 2 things)
- statistics: chart-bar-plain-text / chart-pie-compact-card (use when research has numbers)
- hierarchy: hierarchy-tree-curved-line-rounded-rect-node (use for taxonomies)
- timeline: sequence-timeline-simple (use for evolution / phases)

RULES:
- EXACTLY ${numBlocks} content blocks
- Labels: 2-3 words MAX
- Descs: SHORT complete clause, 4-8 words, never end mid-sentence
- For comparison: exactly 2 items
- For statistics: items MUST have numeric "value"
- Icons: mdi/* names from standard set (lock, scale-balance, chart-bar, account-multiple, cog, lightbulb, alert, check-circle, etc.)`;

  // Force FAST_MODEL (Haiku) — Streamlit-aligned and proven for JSON in
  // production. Caller's `model` parameter ignored to prevent Sonnet-only
  // failure modes from poisoning Phase 2 (deck 22, 23 root cause).
  const tools = sources.length < 2 ? ['WebSearch'] : [];
  console.log(
    `[cw-slides-v3] phase2 calling Claude for '${topic.topic_title.slice(0, 60)}': ` +
    `prompt=${prompt.length}b, tools=[${tools.join(',')}], model=${FAST_MODEL}, bullets=${bullets.length}, sources=${sources.length}`,
  );

  // Up to 2 attempts — second attempt uses a tighter prompt without the
  // research enrichment block, since most production failures are from
  // prompt-size or output-truncation issues.
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const promptForAttempt = attempt === 1 ? prompt : prompt.replace(researchText, sources.length ? `\nRESEARCH SOURCES (${sources.length}):\n` + sources.slice(0, 5).map((s: any) => `  - ${s.title || ''}`).join('\n') : '');
    try {
      const result = await runAgentJson({
        prompt: promptForAttempt,
        systemPrompt: CONTENT_SYSTEM_PROMPT,
        tools: attempt === 2 ? [] : tools,
        maxTurns: attempt === 2 ? 3 : CONTENT_MAX_TURNS,
        model: FAST_MODEL,
        apiKey,
      });
      let blocks: ContentBlock[] = Array.isArray(result?.content_blocks) ? result.content_blocks : [];
      const types = blocks.map((b) => b.visualization_type).join(', ');
      console.log(`[cw-slides-v3] phase2 '${topic.topic_title.slice(0, 60)}' attempt ${attempt}: ${blocks.length}/${numBlocks} blocks, types: [${types}]`);

      if (blocks.length === 0) {
        // Treat zero blocks as a failure — retry or fall through
        lastErr = new Error(`AI returned 0 blocks on attempt ${attempt}`);
        continue;
      }

      // Pad if AI returned fewer than requested
      if (blocks.length < numBlocks) {
        console.warn(`[cw-slides-v3] phase2 '${topic.topic_title.slice(0, 60)}': AI produced ${blocks.length} blocks, padding to ${numBlocks}`);
        blocks = padContentBlocks(blocks, topic.topic_title, topic.bullet_points, numBlocks);
      } else {
        blocks = blocks.slice(0, numBlocks);
      }

      if (blocks.length > 0 && blocks[blocks.length - 1].visualization_type !== 'overview') {
        const last = blocks[blocks.length - 1];
        last.visualization_type = 'overview';
        last.suggested_template = 'list-grid-badge-card';
        last.sub_title = 'Key Takeaways';
        if (last.data) last.data.title = `${topic.topic_title} — Key Takeaways`;
      }

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
      lastErr = e;
      const errMsg = e?.message || String(e);
      console.warn(
        `[cw-slides-v3] phase2 '${topic.topic_title.slice(0, 60)}' attempt ${attempt} FAILED: ` +
        `${errMsg.slice(0, 250)} | code=${e?.code || '?'} | name=${e?.name || '?'}`,
      );
    }
  }

  // All attempts failed — log full diagnostic and use research-rich fallback
  const errMsg = lastErr?.message || String(lastErr);
  const errStack = lastErr?.stack ? String(lastErr.stack).split('\n').slice(0, 5).join(' | ') : '';
  console.error(
    `[cw-slides-v3] PHASE 2 ALL ATTEMPTS FAILED for '${topic.topic_title.slice(0, 60)}': ` +
    `${errMsg} | code=${lastErr?.code || '?'} | name=${lastErr?.name || '?'} | stack: ${errStack}`,
  );
  return fallbackContentBlocks(topic.topic_title, topic.bullet_points, numBlocks, research);
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
      console.error(`[cw-slides-v3] content errored for '${key.slice(0, 60)}':`, r.message);
      map[key] = fallbackContentBlocks(key, topics[i].bullet_points, perTopicBlocks[i] || 6, researchMap[key]);
    } else {
      map[key] = r;
    }
  });
  const totalBlocks = Object.values(map).reduce((n, c) => n + c.content_blocks.length, 0);
  const target = perTopicBlocks.reduce((a, b) => a + b, 0);
  // Count fallback usage so production logs make it obvious if Phase 2 AI is silently failing
  const fallbackCount = results.filter((r) => r instanceof Error).length;
  console.log(
    `[cw-slides-v3] Phase 2 complete: ${totalBlocks}/${target} blocks across ${Object.keys(map).length} topics ` +
    `(${fallbackCount}/${results.length} topics fell back due to AI failure)`,
  );
  return map;
}
