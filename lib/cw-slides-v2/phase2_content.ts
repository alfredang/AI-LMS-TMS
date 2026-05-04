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
  research?: ResearchEntry,
): ContentBlock[] {
  if (existing.length >= target) return existing.slice(0, target);
  const blocks: ContentBlock[] = [...existing];
  const bps = bullets.filter((b) => String(b ?? '').trim().length >= 10);

  // Pull real content from research where available, so padded blocks
  // contain actual researched material instead of generic "Detail N" stubs.
  const r = research || {} as any;
  const procSteps: string[] = r?.infographic_data?.process_steps?.filter((s: any) => typeof s === 'string' && s.trim().length > 5) ?? [];
  const compItems: any[] = r?.infographic_data?.comparison_items ?? [];
  const chartData: any[] = r?.infographic_data?.chart_data ?? [];
  const sources: any[] = r?.sources ?? [];
  // Flatten key_findings across sources into bite-sized phrases for items.
  const findings: string[] = [];
  for (const s of sources) {
    for (const f of (s.key_findings || [])) {
      const t = String(f).trim();
      if (t.length >= 10 && t.length <= 200) findings.push(t);
    }
  }

  // Extract a SHORT (1-2 word) key concept from the topic title for
  // use in subtitles. Streamlit uses short keyword extracts like
  // "Ethical Risk", "AI Ethics", "Privacy Measures" — NOT the full
  // 5-word topic title repeated everywhere. Strategy: skip filler
  // verbs/prepositions, take the 1-2 most informative noun-like
  // words. Avoids awkward subtitles like "Foundations of AI Prompt
  // Engineering Foundations".
  const STOP_WORDS = new Set([
    'the','a','an','of','in','on','to','for','and','or','with','by',
    'apply','maintain','develop','compare','configure','exercise',
    'design','implement','introduce','introduction','overview',
    'foundations','basics','fundamentals','principles',
    'using','through','via','from','at','about','that','which',
    'data','content','information','application','applications',
    'tools','platforms','techniques','strategies','methods',
    'including','such','as','e.g.','etc.',
  ]);
  // Allow 2-letter tech acronyms (AI, ML, UI, UX, IT, OS, IP, AR, VR)
  // since they're often the most semantically important words in WSQ
  // tech topic titles. Without this, "Agentic AI" → "Agentic Agents"
  // because AI gets dropped for being 2 chars.
  const TECH_ACRONYMS_2 = new Set([
    'ai','ml','ui','ux','it','os','ip','ar','vr','db','qa','qc',
    'rd','pm','hr','it','io','3d','2d','5g','4g','3g',
  ]);
  function extractKeyConcept(title: string): string {
    // Strip parens/brackets, drop everything after ' - ' or ',' or ';'
    // (those usually mark "e.g. AgentX, Promptly, Dify..." enumerations
    // which we don't want in the concept)
    let clean = title.replace(/[\(\[].*?[\)\]]/g, '');
    clean = clean.split(/\s+[-–—]\s+/)[0];        // before first " - "
    clean = clean.split(/[,;]/)[0];                // before first comma/semicolon
    clean = clean.replace(/[.,;:!?]/g, ' ');
    // Convert "no-code" / "low-code" hyphenated terms into single tokens
    clean = clean.replace(/\bno[-\s]code\b/gi, 'No-Code')
                 .replace(/\blow[-\s]code\b/gi, 'Low-Code');
    const words = clean.split(/\s+/).filter(Boolean);
    const informative: string[] = [];
    for (const w of words) {
      if (informative.length >= 2) break;
      const lw = w.toLowerCase();
      if (STOP_WORDS.has(lw)) continue;
      // Allow 2-char tech acronyms; otherwise require 3+ chars
      if (w.length < 3 && !TECH_ACRONYMS_2.has(lw)) continue;
      informative.push(w);
    }
    if (informative.length === 0) {
      // Fall back: take first 2 non-stop words regardless of length
      return words.filter((w) => !STOP_WORDS.has(w.toLowerCase())).slice(0, 2).join(' ');
    }
    return informative.join(' ');
  }
  const concept = extractKeyConcept(topicTitle).slice(0, 30); // e.g. "AI Agents", "No-Code AI", "Excel Workspace"

  // Subtitle pools — large enough to support 20+ blocks per topic
  // without repeating. Subtitle = concept + concept-type suffix.
  // Mirrors Streamlit's "Key X Categories", "X Assessment Process"
  // pattern but uses the SHORT concept instead of full topic title.
  const SUBTITLE_POOLS: Record<string, string[]> = {
    overview: [
      `Key ${concept} Concepts`,
      `${concept} Fundamentals`,
      `${concept} Categories`,
      `Core ${concept} Components`,
      `Essential ${concept} Elements`,
      `${concept} Building Blocks`,
      `${concept} Key Aspects`,
      `${concept} Foundations`,
      `${concept} Definitions`,
    ],
    process: [
      `${concept} Implementation Process`,
      `${concept} Workflow`,
      `${concept} Operational Stages`,
      `${concept} Procedure`,
      `${concept} Lifecycle`,
      `${concept} Step-by-Step`,
    ],
    comparison: [
      `${concept} Approach Comparison`,
      `Traditional vs Modern ${concept}`,
      `${concept} Method Trade-offs`,
      `${concept} Best vs Common Practice`,
    ],
    statistics: [
      `${concept} Industry Metrics`,
      `${concept} Adoption Statistics`,
      `${concept} Performance Data`,
      `${concept} Market Trends`,
    ],
    hierarchy: [
      `${concept} Framework`,
      `${concept} Taxonomy`,
      `${concept} Component Hierarchy`,
      `${concept} Structural Map`,
    ],
    timeline: [
      `${concept} Evolution Timeline`,
      `${concept} Implementation Roadmap`,
      `${concept} Historical Milestones`,
      `${concept} Development Phases`,
    ],
    cycle: [
      `${concept} Continuous Cycle`,
      `${concept} Iterative Process`,
      `${concept} Feedback Loop`,
    ],
    quadrant: [
      `${concept} Strategic Quadrants`,
      `${concept} Decision Matrix`,
      `${concept} Trade-off Map`,
    ],
    relationship: [
      `${concept} Component Relationships`,
      `${concept} Interconnections`,
      `${concept} Dependency Map`,
    ],
  };
  // Per-pool counters so each viz_type rotates through its pool
  const poolCursors: Record<string, number> = {};

  let padIdx = 0;
  let procCursor = 0;
  let findingCursor = 0;
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

    // Pick a unique subtitle from the viz_type pool
    const pool = SUBTITLE_POOLS[vizType] || SUBTITLE_POOLS.overview;
    const cursorIdx = poolCursors[vizType] || 0;
    let derivedSubTitle = pool[cursorIdx % pool.length];
    poolCursors[vizType] = cursorIdx + 1;

    let items: ContentBlockItem[];

    // For each viz type, prefer research-derived content over generic stubs.
    if (vizType === 'process' && procSteps.length - procCursor >= 3) {
      const stepChunk = procSteps.slice(procCursor, procCursor + 5);
      procCursor += stepChunk.length;
      items = stepChunk.map((s, i) => ({
        label: `Step ${i + 1}`,
        desc: s.slice(0, 80),
        icon: 'mdi/arrow-right-circle',
      }));
    } else if (vizType === 'comparison' && compItems.length >= 2) {
      const pair = compItems.slice(0, 2);
      items = pair.map((c, i) => ({
        label: String(c.label ?? (i === 0 ? 'Approach A' : 'Approach B')).slice(0, 28),
        desc: String(c.desc ?? '').slice(0, 80),
        icon: i === 0 ? 'mdi/history' : 'mdi/rocket-launch',
      }));
    } else if (vizType === 'statistics' && chartData.length >= 2) {
      items = chartData.slice(0, 5).map((d) => ({
        label: String(d.label ?? '').slice(0, 28) || 'Metric',
        desc: String(d.label ?? ''),
        value: typeof d.value === 'number' ? d.value : 50,
        icon: 'mdi/chart-bar',
      }));
    } else if (findings.length - findingCursor >= 3) {
      // Use research key_findings — Wikipedia article sentences. Cap desc
      // at ~50 chars to fit infographic template limits without mid-
      // sentence truncation, and break at clean word boundaries.
      const chunk = findings.slice(findingCursor, findingCursor + 4);
      findingCursor += chunk.length;
      const truncWord = (s: string, max: number) => {
        if (s.length <= max) return s;
        const cut = s.slice(0, max);
        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.!?]+$/, '');
      };
      // Decode any leftover HTML entities in finding text and skip
      // citation-style leading words ("Retrieved", "Archived", quotes).
      const HTML_ENT: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
      const cleanText = (s: string) => s.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENT[m] || m).replace(/^["'']+/, '').replace(/^(retrieved|archived|see also|references?)\b[^.!?]*[.!?]?\s*/i, '').trim();
      items = chunk.map((f, idx) => {
        const cleaned = cleanText(f);
        // Generate a meaningful label by extracting the SUBJECT of the
        // sentence (skip leading prepositions/articles), max 3 words.
        const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
        const skipLeading = ['the','a','an','this','that','these','those','it','they','we','you','i'];
        let labelStart = 0;
        while (labelStart < words.length && skipLeading.includes(words[labelStart].toLowerCase())) labelStart++;
        const label = words.slice(labelStart, labelStart + 3).join(' ');
        return {
          label: truncWord(label, 25) || `Concept ${bi + 1}`,
          desc: truncWord(cleaned, 50),
          icon: 'mdi/lightbulb',
        };
      });
    } else if (bpChunk.length) {
      items = bpChunk.map((bp) => ({
        label: bp.split(' ').slice(0, 3).join(' ').slice(0, 28),
        desc: bp,
        icon: 'mdi/chevron-right',
      }));
    } else if (vizType === 'comparison') {
      items = [
        { label: 'Traditional', desc: `Traditional approach to ${concept}`, icon: 'mdi/history' },
        { label: 'Modern', desc: `Modern approach to ${concept}`, icon: 'mdi/rocket-launch' },
      ];
    } else if (vizType === 'statistics') {
      items = [
        { label: 'Adoption', value: 73, desc: `Industry adoption of ${concept}`, icon: 'mdi/trending-up' },
        { label: 'Efficiency', value: 45, desc: 'Efficiency gains realized', icon: 'mdi/chart-line' },
        { label: 'Cost Reduction', value: 30, desc: 'Cost savings achieved', icon: 'mdi/currency-usd' },
      ];
    } else {
      // Last resort — short, complete-phrase descriptions that FIT within
      // infographic template limits (~30-40 chars). Icons restricted to
      // the 80-icon static bundle in lib/cw-slides-icon-cache.json so
      // snapToCachedIcon doesn't fall to repeated default icons.
      const conceptPools: Array<Array<ContentBlockItem>> = [
        [
          { label: 'Core Concepts', desc: 'Fundamental ideas and definitions', icon: 'mdi/lightbulb' },
          { label: 'Application', desc: 'Practical real-world usage', icon: 'mdi/cog' },
          { label: 'Standards', desc: 'Industry-recognised guidelines', icon: 'mdi/check-circle' },
          { label: 'Outcomes', desc: 'Measurable business benefits', icon: 'mdi/star' },
        ],
        [
          { label: 'Purpose', desc: 'Why this matters in practice', icon: 'mdi/help-circle' },
          { label: 'Approach', desc: 'How to apply the framework', icon: 'mdi/arrow-right-circle' },
          { label: 'Timing', desc: 'When to use each method', icon: 'mdi/clock' },
          { label: 'Context', desc: 'Where it best applies', icon: 'mdi/earth' },
        ],
        [
          { label: 'Skills', desc: 'Required competencies', icon: 'mdi/school' },
          { label: 'Tools', desc: 'Software and resources', icon: 'mdi/cog' },
          { label: 'Methods', desc: 'Proven techniques', icon: 'mdi/format-list-bulleted' },
          { label: 'Quality', desc: 'Best-practice indicators', icon: 'mdi/trophy' },
        ],
        [
          { label: 'Inputs', desc: 'Required data and resources', icon: 'mdi/database' },
          { label: 'Process', desc: 'Step-by-step transformation', icon: 'mdi/refresh' },
          { label: 'Outputs', desc: 'Expected deliverables', icon: 'mdi/file-document' },
          { label: 'Validation', desc: 'Quality assurance checks', icon: 'mdi/clipboard-check' },
        ],
      ];
      items = conceptPools[bi % conceptPools.length];
    }

    const subTitle = derivedSubTitle
      || (bpChunk.length ? bpChunk[0].split(' ').slice(0, 6).join(' ').slice(0, 60) : `${concept} Concepts ${bi}`);

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

  const tools = sources.length < 2 ? ['WebSearch'] : [];

  // Iterative batched calls — ask for 4 blocks at a time instead of 20.
  // Single big asks routinely truncate in production (model returns
  // 0-2 blocks instead of 20). Multiple smaller asks each fit comfortably
  // within Claude's output budget, so each succeeds reliably. Total
  // production time goes up (5x calls per topic) but content quality
  // matches Streamlit because every block is real Claude output, not
  // padding fallback.
  const BATCH_SIZE = 4;
  const MAX_BATCHES = Math.ceil(numBlocks / BATCH_SIZE) + 1; // +1 buffer
  const allBlocks: ContentBlock[] = [];
  let activity: ActivityData | undefined;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if (allBlocks.length >= numBlocks) break;
    const remaining = numBlocks - allBlocks.length;
    const askThisBatch = Math.min(BATCH_SIZE, remaining);
    const startIdx = allBlocks.length;
    const isFirstBatch = batch === 0;
    const isLastBatch = startIdx + askThisBatch >= numBlocks;

    // Tell Claude what blocks already exist so it doesn't duplicate
    const existingSummary = allBlocks.length > 0
      ? '\n\nALREADY GENERATED BLOCKS (do NOT repeat these themes):\n' +
        allBlocks.map((b, i) => `  ${i + 1}. [${b.visualization_type}] ${b.sub_title}`).join('\n')
      : '';

    let positionGuidance = '';
    if (isFirstBatch) {
      positionGuidance = '\nThis is the FIRST batch — START with a "overview" block titled "What is ' + topic.topic_title + '?" as block 0.';
    } else if (isLastBatch) {
      positionGuidance = '\nThis is the LAST batch — END with an "overview" block titled "Key Takeaways" or similar.';
    } else {
      positionGuidance = '\nMIDDLE batch — VARY visualization types: process, comparison, statistics, hierarchy, timeline, cycle. NO overview blocks here.';
    }

    const batchPrompt = `Create ${askThisBatch} content blocks (block index ${startIdx} to ${startIdx + askThisBatch - 1}) for this topic. Each block = one infographic slide.

COURSE: ${courseTitle}
LEARNING UNIT: ${topic.lu_title}
LEARNING OUTCOME: ${topic.lo_description}
TOPIC: ${topic.topic_title}
${bpText}
${researchText}
${researchHint}
${existingSummary}
${positionGuidance}

Return this JSON:
{
  "content_blocks": [
    {
      "block_index": ${startIdx},
      "sub_title": "Specific Concept Title (e.g. 'Risk Categories', 'Implementation Process', 'Industry Statistics')",
      "visualization_type": "overview" | "process" | "comparison" | "statistics" | "hierarchy" | "timeline" | "cycle",
      "suggested_template": "matching AntV template",
      "data": {
        "title": "Short Title (3-6 words)",
        "desc": "Brief one-line overview",
        "items": [
          {"label": "Specific Concept", "desc": "Real fact or insight from research", "icon": "mdi/relevant-icon"}
        ]
      },
      "caption": "Source: Name, Year",
      "sources_used": ["Source Name"]
    }
    /* ${askThisBatch} blocks total — sub_titles must be SPECIFIC topic concepts, NOT generic placeholders like "Detail" or "Point" */
  ]${isFirstBatch ? `,
  "activity": {
    "title": "Real-world Exercise Name",
    "scenario": "Industry-relevant scenario tied to the topic",
    "steps": ["Step 1: Specific action", "Step 2: Specific action", "Step 3: Specific action"],
    "expected_output": "Concrete deliverable",
    "duration": "20 minutes"
  }` : ''}
}

CRITICAL RULES:
- EVERY item.label must be a SPECIFIC concept from the research (e.g. "RAG Pipeline", "Token Limits", "Few-Shot Prompts" — NOT "Foundation", "Standards", "Tools")
- EVERY item.desc must be a complete short phrase with REAL info from the research/CP, not a generic placeholder
- sub_titles must be UNIQUE specific concepts (e.g. "Prompt Engineering Patterns", "Token Cost Analysis", NOT "Implementation Process" repeated)
- items[]: 4-5 items per block, each with content-specific mdi/* icon
- For "comparison": EXACTLY 2 root items with children (real things being compared)
- For "statistics": items MUST have numeric "value" with real numbers
`;

    try {
      const result = await runAgentJson({
        prompt: batchPrompt,
        systemPrompt: CONTENT_SYSTEM_PROMPT,
        tools,
        maxTurns: CONTENT_MAX_TURNS,
        model: model || FAST_MODEL,
        apiKey,
      });
      const newBlocks: ContentBlock[] = Array.isArray(result?.content_blocks) ? result.content_blocks : [];
      if (newBlocks.length === 0) {
        console.warn(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}' batch ${batch + 1}/${MAX_BATCHES}: 0 blocks returned, stopping iterative gen`);
        break;
      }
      // Re-index to continue from where we are
      for (const b of newBlocks) {
        b.block_index = allBlocks.length;
        allBlocks.push(b);
      }
      if (isFirstBatch && result?.activity) activity = result.activity;
      console.log(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}' batch ${batch + 1}: +${newBlocks.length} blocks (${allBlocks.length}/${numBlocks})`);
    } catch (e: any) {
      console.warn(`[cw-slides-v2] '${topic.topic_title.slice(0, 60)}' batch ${batch + 1} failed: ${e.message}`);
      break;
    }
  }

  // Pad any remaining gap (only if iterative gen didn't fully fill)
  let blocks = allBlocks;
  if (blocks.length < numBlocks) {
    blocks = padContentBlocks(blocks, topic.topic_title, topic.bullet_points, numBlocks, research);
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
    activity,
  };
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
      map[key] = { topic: key, content_blocks: padContentBlocks([], key, topics[i].bullet_points, perTopicBlocks[i] || 6, researchMap[key]) };
    } else {
      map[key] = r;
    }
  });
  return map;
}
