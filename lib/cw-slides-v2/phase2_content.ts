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
  ActivityData,
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

// Build topic-derived fallback items when neither research nor CP
// bullet points are available. Anchors every item on the topic concept
// so the card always talks about THIS topic, never generic Purpose/
// Approach/Timing/Context filler. Per-viz-type pools keep variety
// across blocks.
function topicDerivedItems(topicTitle: string, concept: string, vizType: string, blockIdx: number): ContentBlockItem[] {
  const t = concept || topicTitle;
  const lower = t.toLowerCase();
  // Domain-flavoured iconography per concept keywords
  const iconOf = (kind: string): string => {
    if (/ethic|moral|fair|bias/i.test(t)) {
      return ({ overview: 'mdi/scale-balance', risk: 'mdi/alert', tool: 'mdi/cog', metric: 'mdi/chart-pie', best: 'mdi/check-circle' } as any)[kind] || 'mdi/scale-balance';
    }
    if (/privacy|anonymis|encrypt|secur|protect/i.test(t)) {
      return ({ overview: 'mdi/lock', risk: 'mdi/shield-alert', tool: 'mdi/shield', metric: 'mdi/percent', best: 'mdi/check-circle' } as any)[kind] || 'mdi/lock';
    }
    if (/data|database|storage|record/i.test(t)) {
      return ({ overview: 'mdi/database', risk: 'mdi/database-alert', tool: 'mdi/database-cog', metric: 'mdi/chart-bar', best: 'mdi/database-check' } as any)[kind] || 'mdi/database';
    }
    if (/ai|machine|learning|model|algorithm/i.test(t)) {
      return ({ overview: 'mdi/brain', risk: 'mdi/alert-circle', tool: 'mdi/cog', metric: 'mdi/chart-line', best: 'mdi/check-circle' } as any)[kind] || 'mdi/brain';
    }
    if (/cloud|aws|azure|gcp/i.test(t)) {
      return ({ overview: 'mdi/cloud', risk: 'mdi/cloud-alert', tool: 'mdi/cloud-cog', metric: 'mdi/chart-bar', best: 'mdi/cloud-check' } as any)[kind] || 'mdi/cloud';
    }
    return ({ overview: 'mdi/lightbulb', risk: 'mdi/alert', tool: 'mdi/cog', metric: 'mdi/chart-bar', best: 'mdi/check-circle' } as any)[kind] || 'mdi/lightbulb';
  };

  const POOLS: Record<string, ContentBlockItem[][]> = {
    overview: [
      [
        { label: `${t} Definition`, desc: `Core meaning and scope of ${t.toLowerCase()}`, icon: iconOf('overview') },
        { label: `${t} Drivers`, desc: `Why ${t.toLowerCase()} matters in industry`, icon: iconOf('best') },
        { label: `${t} Scope`, desc: `Boundaries and key application areas`, icon: 'mdi/earth' },
        { label: `${t} Stakeholders`, desc: `Roles involved across the lifecycle`, icon: 'mdi/account-multiple' },
      ],
      [
        { label: `Key Principles`, desc: `Foundational rules guiding ${t.toLowerCase()}`, icon: iconOf('overview') },
        { label: `Industry Standards`, desc: `Recognised standards used in practice`, icon: 'mdi/file-check' },
        { label: `Common Pitfalls`, desc: `Mistakes practitioners typically avoid`, icon: iconOf('risk') },
        { label: `Success Markers`, desc: `Signals that ${t.toLowerCase()} is working`, icon: iconOf('best') },
      ],
    ],
    process: [
      [
        { label: `Step 1`, desc: `Define ${t.toLowerCase()} requirements and goals`, icon: 'mdi/flag' },
        { label: `Step 2`, desc: `Plan controls, roles and tooling`, icon: 'mdi/clipboard-text' },
        { label: `Step 3`, desc: `Implement and validate the approach`, icon: 'mdi/cog' },
        { label: `Step 4`, desc: `Monitor outcomes and iterate`, icon: 'mdi/refresh' },
      ],
    ],
    comparison: [
      [
        { label: `Traditional ${t}`, desc: `Manual, ad-hoc handling without ${t.toLowerCase()} discipline`, icon: 'mdi/history' },
        { label: `Modern ${t}`, desc: `Systematic, framework-led approach to ${t.toLowerCase()}`, icon: 'mdi/rocket-launch' },
      ],
    ],
    statistics: [
      [
        { label: 'Adoption', value: 73, desc: '', icon: 'mdi/trending-up' },
        { label: 'Risk Incidents', value: 42, desc: '', icon: iconOf('risk') },
        { label: 'Compliance', value: 61, desc: '', icon: iconOf('best') },
        { label: 'Maturity', value: 35, desc: '', icon: iconOf('metric') },
      ],
    ],
    hierarchy: [
      [
        { label: t, desc: `Top-level ${t.toLowerCase()} concept`, icon: iconOf('overview'), children: [
          { label: 'People', desc: 'Roles & responsibilities', icon: 'mdi/account-multiple' },
          { label: 'Process', desc: 'Workflows & controls', icon: 'mdi/cog' },
          { label: 'Tools', desc: 'Platforms & utilities', icon: 'mdi/toolbox' },
        ] },
      ],
    ],
    timeline: [
      [
        { label: 'Past', desc: `Origins and early ${t.toLowerCase()} practice`, icon: 'mdi/history' },
        { label: 'Present', desc: `Today's ${t.toLowerCase()} norms`, icon: 'mdi/clock' },
        { label: 'Emerging', desc: 'Recent advances and pilots', icon: 'mdi/lightbulb' },
        { label: 'Future', desc: `Where ${t.toLowerCase()} is heading`, icon: 'mdi/rocket-launch' },
      ],
    ],
    cycle: [
      [
        { label: 'Plan', desc: `Set ${t.toLowerCase()} objectives`, icon: 'mdi/flag' },
        { label: 'Apply', desc: 'Execute and document', icon: 'mdi/cog' },
        { label: 'Review', desc: 'Evaluate outcomes', icon: 'mdi/file-search' },
        { label: 'Improve', desc: 'Refine for the next cycle', icon: 'mdi/refresh' },
      ],
    ],
    quadrant: [
      [
        { label: 'High Impact', desc: 'Critical to address first', icon: iconOf('risk') },
        { label: 'Quick Wins', desc: 'Fast to implement', icon: 'mdi/rocket-launch' },
        { label: 'Strategic', desc: 'Long-horizon investments', icon: 'mdi/flag' },
        { label: 'Watch List', desc: 'Monitor for changes', icon: 'mdi/eye' },
      ],
    ],
    relationship: [
      [
        { label: 'Inputs', desc: `Resources feeding ${t.toLowerCase()}`, icon: 'mdi/database' },
        { label: 'Process', desc: 'Transformation steps', icon: 'mdi/cog' },
        { label: 'Outputs', desc: 'Deliverables produced', icon: 'mdi/file-document' },
        { label: 'Feedback', desc: 'Loop for continuous improvement', icon: 'mdi/refresh' },
      ],
    ],
  };
  const pool = POOLS[vizType] || POOLS.overview;
  return pool[blockIdx % pool.length].map((it) => ({ ...it }));
}

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

  // Extract a SHORT (2-3 word) key concept from the topic title for
  // use in subtitles. Streamlit uses Title-Cased keyword extracts
  // ("Ethical Principles", "Privacy Measures", "AI Anonymisation")
  // — NOT lowercase fragments and NOT mid-word truncations like
  // "anonymisation de-identificatio" that show up when slicing
  // by character count.
  //
  // Strategy:
  //   1) Strip parentheticals and "e.g." enumerations
  //   2) Drop common verbs ("Apply", "Compare", "Design") at the start
  //   3) Drop pure stop words ("the", "of", "in")
  //   4) DO NOT drop "principles", "considerations", "techniques",
  //      "measures" — those ARE the core domain concepts in WSQ
  //      topic titles and dropping them makes the concept meaningless
  //   5) Title-case every word so subtitles read consistently
  //   6) Stop on word boundary at a 2-3 word phrase, never mid-word
  const VERBS_TO_DROP_AT_START = new Set([
    'apply','maintain','develop','compare','configure','exercise',
    'design','implement','introduce','use','manage','create','build',
    'identify','perform','demonstrate','explain','describe','analyse',
    'analyze','evaluate','assess','prepare','operate','conduct',
  ]);
  const PURE_STOP_WORDS = new Set([
    'the','a','an','of','in','on','to','for','and','or','with','by',
    'using','through','via','from','at','about','that','which','when',
    'where','while','whilst','during','after','before','until','since',
    'because','if','unless','based','related','regarding','concerning',
    'including','such','as','e.g.','etc.','its','their','this','these',
  ]);
  const TECH_ACRONYMS_2 = new Set([
    'ai','ml','ui','ux','it','os','ip','ar','vr','db','qa','qc',
    'rd','pm','hr','io','3d','2d','5g','4g','3g',
  ]);
  function titleCase(w: string): string {
    if (!w) return w;
    if (TECH_ACRONYMS_2.has(w.toLowerCase()) || /^[A-Z]{2,}$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  function extractKeyConcept(title: string): string {
    // Strip parens/brackets, drop everything after ' - ' or ',' or ';'
    let clean = title.replace(/[\(\[].*?[\)\]]/g, '');
    clean = clean.split(/\s+[-–—]\s+/)[0];        // before first " - "
    clean = clean.split(/[,;]/)[0];                // before first comma/semicolon
    clean = clean.replace(/[.,;:!?]/g, ' ');
    clean = clean.replace(/\bno[-\s]code\b/gi, 'No-Code')
                 .replace(/\blow[-\s]code\b/gi, 'Low-Code');
    const words = clean.split(/\s+/).filter(Boolean);
    // Skip leading verb if any
    let startIdx = 0;
    while (startIdx < words.length && VERBS_TO_DROP_AT_START.has(words[startIdx].toLowerCase())) {
      startIdx++;
    }
    const informative: string[] = [];
    for (let i = startIdx; i < words.length; i++) {
      const w = words[i];
      const lw = w.toLowerCase();
      if (PURE_STOP_WORDS.has(lw)) {
        // Stop words break the phrase — but only AFTER we have at least 1 word
        if (informative.length >= 1) break;
        continue;
      }
      if (w.length < 3 && !TECH_ACRONYMS_2.has(lw)) continue;
      informative.push(titleCase(w));
      if (informative.length >= 3) break;
    }
    if (informative.length === 0) {
      const fallback = words.filter((w) => !PURE_STOP_WORDS.has(w.toLowerCase())).slice(0, 2).map(titleCase);
      return fallback.join(' ') || titleCase(words[0] || 'Topic');
    }
    return informative.join(' ');
  }
  // Word-boundary cap (NEVER mid-word). 36 chars fits subtitle band.
  function capWords(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    const cut = s.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  }
  const concept = capWords(extractKeyConcept(topicTitle), 36);

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
  // Track which viz types are unsuitable for the available research data.
  // Don't pick statistics if no real numeric data — forces text fragments
  // into pie chart slots producing nonsensical "10% / 20% / 30% / 40%"
  // pies labelled with sentence fragments.
  const skipStats = chartData.length < 2;
  // Skip comparison if no real comparison_items — produces empty
  // "Pros / Cons" arrows.
  const skipComparison = compItems.length < 2;
  // Per-topic dedup set — reset for every padContentBlocks call so labels
  // don't repeat across cards / blocks within one topic.
  const seenLabelsTopic = new Set<string>();

  while (blocks.length < target) {
    const bi = blocks.length;
    let [vizType, template] = PAD_TEMPLATES[padIdx % PAD_TEMPLATES.length];
    padIdx++;

    // Skip viz types that don't have real backing data (would produce
    // empty/garbage infographics)
    let safetyHop = 0;
    while (safetyHop < PAD_TEMPLATES.length && (
      (vizType === 'statistics' && skipStats) ||
      (vizType === 'comparison' && skipComparison) ||
      (blocks.length && blocks[blocks.length - 1].visualization_type === vizType)
    )) {
      [vizType, template] = PAD_TEMPLATES[padIdx % PAD_TEMPLATES.length];
      padIdx++;
      safetyHop++;
    }

    const bpStart = bi * 2;
    const bpChunk = bpStart < bps.length ? bps.slice(bpStart, bpStart + 4) : [];

    // Pick a unique subtitle from the viz_type pool
    const pool = SUBTITLE_POOLS[vizType] || SUBTITLE_POOLS.overview;
    const cursorIdx = poolCursors[vizType] || 0;
    let derivedSubTitle = pool[cursorIdx % pool.length];
    poolCursors[vizType] = cursorIdx + 1;

    // ─── Helpers used by every branch ──────────────────────────────────
    const truncWord = (s: string, max: number): string => {
      if (!s) return '';
      if (s.length <= max) return s;
      const cut = s.slice(0, max);
      const lastSpace = cut.lastIndexOf(' ');
      return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.!?\-]+$/, '');
    };
    const HTML_ENT: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
    const cleanText = (s: string): string => s.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENT[m] || m)
      .replace(/^["'`'']+/, '')
      .replace(/^(retrieved|archived|see also|references?)\b[^.!?]*[.!?]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const VERBS = /^(is|are|was|were|be|been|being|am|have|has|had|having|do|does|did|doing|can|could|will|would|should|shall|may|might|must|ought|need|needs|needed|use|uses|used|using|make|makes|made|making|take|takes|took|taken|taking|get|gets|got|getting|come|comes|came|coming|go|goes|went|gone|going|see|sees|saw|seen|seeing|know|knows|knew|known|knowing|think|thinks|thought|thinking|say|says|said|saying|introduce|introduced|introduces|release|released|releases|provide|provided|provides|found|founded|founds|develop|developed|develops|create|created|creates|build|built|builds|building|aim|aims|aimed|seek|seeks|sought|seeking|describe|described|describes|covers|cover|covered|involves|involve|involved|includes|include|included|allows|allow|allowed|enables|enable|enabled|requires|require|required|encompasses|encompass|reflects|reflect|highlights|highlight)$/i;
    const STOPS = new Set(['the','a','an','this','that','these','those','it','they','we','you','i','in','on','at','of','for','to','from','by','with','and','or','but','as','its','their','his','her','our','your','than','then','also','such','about','into','onto','upon','via','per','no','not']);
    const PUNCT = /[.,;:!?()'"\[\]]/g;
    const labelFromSentence = (sent: string): string => {
      const cleaned = sent.replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
      const words = cleaned.split(' ').filter((w) => w.length >= 2);
      if (!words.length) return '';
      let anchor = -1;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const lw = w.toLowerCase();
        if (STOPS.has(lw)) continue;
        if (VERBS.test(lw)) continue;
        if (w.length < 4 && !/^[A-Z]{2,}$/.test(w)) continue;
        anchor = i;
        break;
      }
      if (anchor === -1) return '';
      const phrase: string[] = [];
      for (let i = anchor; i < words.length && phrase.length < 3; i++) {
        const w = words[i];
        const lw = w.toLowerCase();
        if (phrase.length > 0 && (STOPS.has(lw) || VERBS.test(lw))) break;
        phrase.push(w);
      }
      if (phrase.length === 1 && phrase[0].length < 4) return '';
      return phrase.join(' ');
    };

    // ─── Try findings (research key_findings) for any viz type that
    //     can use bullet-style items: overview, process (when no real
    //     procSteps), and as fallback. ───────────────────────────────
    const tryFindingsItems = (count = 4): ContentBlockItem[] | null => {
      const window = findings.slice(findingCursor, findingCursor + 16);
      if (window.length < 2) return null;
      const seenLabels = new Set<string>();
      const seenDescs = new Set<string>();
      const picked: Array<{ label: string; desc: string }> = [];
      let consumed = 0;
      for (const f of window) {
        consumed++;
        if (picked.length >= count) break;
        const desc = cleanText(f);
        if (desc.length < 25) continue;
        const label = labelFromSentence(desc);
        if (!label) continue;
        const labelKey = label.toLowerCase();
        const descKey = desc.slice(0, 30).toLowerCase();
        if (seenLabels.has(labelKey) || seenLabelsTopic.has(labelKey)) continue;
        if (seenDescs.has(descKey)) continue;
        seenLabels.add(labelKey);
        seenLabelsTopic.add(labelKey);
        seenDescs.add(descKey);
        picked.push({ label, desc });
      }
      findingCursor += consumed;
      if (picked.length < 2) return null;
      return picked.map((p) => ({
        label: truncWord(p.label, 24),
        desc: truncWord(p.desc, 48),
        icon: 'mdi/lightbulb',
      }));
    };

    // ─── Pick items per viz_type ──────────────────────────────────────
    let items: ContentBlockItem[];

    if (vizType === 'process' && procSteps.length - procCursor >= 3) {
      const stepChunk = procSteps.slice(procCursor, procCursor + 5);
      procCursor += stepChunk.length;
      items = stepChunk.map((s, i) => ({
        label: `Step ${i + 1}`,
        desc: truncWord(cleanText(s), 60),
        icon: 'mdi/arrow-right-circle',
      }));
    } else if (vizType === 'comparison' && compItems.length >= 2) {
      const pair = compItems.slice(0, 2);
      items = pair.map((c, i) => ({
        label: truncWord(String(c.label ?? (i === 0 ? 'Approach A' : 'Approach B')), 24),
        desc: truncWord(String(c.desc ?? ''), 60),
        icon: i === 0 ? 'mdi/history' : 'mdi/rocket-launch',
      }));
    } else if (vizType === 'statistics' && chartData.length >= 2) {
      items = chartData.slice(0, 5).map((d) => ({
        label: truncWord(String(d.label ?? ''), 24) || 'Metric',
        desc: '',
        value: typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : 50,
        icon: 'mdi/chart-bar',
      }));
    } else {
      // No viz-specific real data — try findings, then bullets, then
      // topic-derived fallback. NEVER use generic Purpose/Approach/Timing/
      // Context skeleton — that's what produces the placeholder slides
      // users complained about.
      const found = tryFindingsItems(4);
      if (found && found.length >= 2) {
        items = found;
      } else if (bpChunk.length >= 2) {
        items = bpChunk.map((bp) => {
          const cleaned = cleanText(bp);
          const lbl = labelFromSentence(cleaned) || cleaned.split(' ').slice(0, 3).join(' ');
          return {
            label: truncWord(lbl, 24),
            desc: truncWord(cleaned, 60),
            icon: 'mdi/chevron-right',
          };
        });
      } else {
        // Last resort — derive items from the TOPIC TITLE itself, so
        // every card stays topic-relevant. We never want generic
        // Purpose/Approach/Timing/Context filler in the final deck.
        items = topicDerivedItems(topicTitle, concept, vizType, bi);
      }
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

  // ALWAYS force the final block of every topic to be an Overview-styled
  // "Key Takeaways" slide, regardless of whether iterative gen filled the
  // count or padding ran. Previously the takeaways slide only appeared on
  // topics that were padded, leaving fully-Claude-generated topics without
  // any takeaways closure.
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    last.visualization_type = 'overview';
    last.suggested_template = 'list-grid-badge-card';
    last.sub_title = 'Key Takeaways';
    if (!last.data) last.data = { items: [] } as any;
    last.data.title = `${topic.topic_title} — Key Takeaways`;
  }

  // Apply research-derived caption to blocks that lack one
  const baseCaption = captionFromResearch(research);
  for (const b of blocks) {
    if (!b.caption || b.caption.trim().length === 0) {
      b.caption = baseCaption;
    }
  }

  // Ensure every topic has an activity slide — synthesize a sensible one
  // from the topic title if Claude didn't return one. Streamlit reference
  // includes an activity per topic; without this, decks miss the most
  // valuable hands-on slide.
  if (!activity || !activity.scenario) {
    activity = {
      title: `Apply ${capWordsForTitle(topic.topic_title)}`,
      scenario: `In small groups, work through a real workplace scenario where ${cleanForActivity(topic.topic_title)} applies. Use what you learned in this topic.`,
      steps: [
        `Identify a recent or hypothetical situation related to ${cleanForActivity(topic.topic_title)}.`,
        'Discuss what challenges arose and the options available.',
        'Decide on the recommended approach and justify it.',
        'Note the risks, controls, and follow-up actions.',
      ],
      expected_output: 'A short summary (3–5 bullet points) covering the chosen approach, justification, and follow-up actions.',
      duration: '20 minutes',
    };
  }

  return {
    topic: topic.topic_title,
    content_blocks: blocks,
    activity,
  };
}

// Title-case a topic title for activity-slide title use ("Apply X").
function capWordsForTitle(s: string): string {
  return String(s || '')
    .replace(/[\(\[].*?[\)\]]/g, '')
    .split(/[,;]/)[0]
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ')
    .slice(0, 70);
}
function cleanForActivity(s: string): string {
  return String(s || '')
    .replace(/[\(\[].*?[\)\]]/g, '')
    .replace(/\s*[,;].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
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
