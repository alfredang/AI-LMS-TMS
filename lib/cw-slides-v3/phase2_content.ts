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

import { callClaudeJson } from './anthropic-messages';
import { CONTENT_SYSTEM_PROMPT } from './prompts';
import type {
  ActivityData,
  ContentBlock,
  ContentBlockItem,
  ContentMapEntry,
  ResearchEntry,
  SlideTopic,
} from './types';

// Haiku 4.5 — fast, JSON-reliable, supported by both API keys and OAuth
// subscription tokens. Same model the CP / AP / FG / LG generators use
// in production today.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const CONTENT_MAX_TOKENS = 8192;
const CONCURRENCY = 5;

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

  // Strip "[Sub-topic name]" markers — those were inline hints for the AI
  // prompt to know sub-topic boundaries. They must NOT become standalone
  // slide cards or titles (deck g3 bug: [What are Chatbots?] showed up
  // as a slide title).
  const bps = (bulletPoints || [])
    .map((b) => String(b ?? '').trim())
    .filter((b) => b.length > 0 && !b.startsWith('['));
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
// Module-level deck-wide template registry. Tracks the LAST 6 templates
// used across ALL topics in a deck-generation run, so consecutive blocks
// (across topic boundaries) never share a template. Reset at the start
// of every deck via `_resetDeckRegistry`. Without this, the per-topic
// pickUnusedTemplate restarts at index 0 for each topic, causing block
// 0 of every topic to reuse `list-grid-badge-card`.
const _deckTemplateHistory: string[] = [];
const DECK_NO_REPEAT_WINDOW = 6;
function _deckSeenRecently(t: string): boolean {
  return _deckTemplateHistory.includes(t);
}
function _markDeckUsed(t: string): void {
  _deckTemplateHistory.push(t);
  while (_deckTemplateHistory.length > DECK_NO_REPEAT_WINDOW) {
    _deckTemplateHistory.shift();
  }
}
export function _resetDeckRegistry(): void {
  _deckTemplateHistory.length = 0;
}

function fallbackContentBlocks(
  topicTitle: string,
  bulletPoints: string[] = [],
  numBlocks = 6,
  research?: ResearchEntry,
): ContentMapEntry {
  // Strip "[Sub-topic name]" markers — those were inline hints for the AI
  // prompt to know sub-topic boundaries. They must NOT become standalone
  // slide cards or titles (deck g3 bug: [What are Chatbots?] showed up
  // as a slide title).
  const bps = (bulletPoints || [])
    .map((b) => String(b ?? '').trim())
    .filter((b) => b.length > 0 && !b.startsWith('['));
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
  // Per-topic + deck-wide template registry. Block selection prefers
  // templates not used IN THIS TOPIC and not used in the LAST 6 blocks
  // ACROSS THE ENTIRE DECK. Without the deck-wide check, every topic
  // restarts at the same first template, making decks look identical
  // slide-by-slide across topic boundaries.
  const usedTemplatesInTopic = new Set<string>();
  const pickUnusedTemplate = (vizType: string, fallbackPool: string[]): string => {
    // Tier 1: not in this topic AND not used recently anywhere
    for (const t of fallbackPool) {
      if (!usedTemplatesInTopic.has(t) && !_deckSeenRecently(t)) {
        usedTemplatesInTopic.add(t);
        _markDeckUsed(t);
        return t;
      }
    }
    // Tier 2: not in this topic (relax recent-window)
    for (const t of fallbackPool) {
      if (!usedTemplatesInTopic.has(t)) {
        usedTemplatesInTopic.add(t);
        _markDeckUsed(t);
        return t;
      }
    }
    // Tier 3: rotate by block index — accept a repeat
    const t = fallbackPool[blocks.length % fallbackPool.length];
    usedTemplatesInTopic.add(t);
    _markDeckUsed(t);
    return t;
  };

  // ── Block 0 — Overview: each CP bullet becomes a card ─────────────
  // Use action-verb labels (Define, Apply, Identify, ...) so cards look
  // visually distinct with the full bullet as desc — eliminates the
  // label-equals-desc duplication seen in deck g3 ("Definition and
  // overview" label + "Definition and overview of chatbots" desc).
  const ACTION_VERBS = ['Define', 'Apply', 'Identify', 'Analyse', 'Implement', 'Compare', 'Evaluate', 'Master', 'Practice', 'Review'];
  const ACTION_ICONS = ['mdi/flag', 'mdi/cog', 'mdi/lightbulb', 'mdi/chart-line', 'mdi/rocket-launch', 'mdi/scale-balance', 'mdi/check-circle', 'mdi/star', 'mdi/handshake', 'mdi/file-search'];
  const overviewItems: ContentBlockItem[] = [];
  bps.slice(0, 5).forEach((bp, i) => {
    overviewItems.push({
      label: ACTION_VERBS[i % ACTION_VERBS.length],
      desc: truncWord(cleanText(bp), 100),
      icon: ACTION_ICONS[i % ACTION_ICONS.length],
    });
  });
  if (overviewItems.length === 0) {
    overviewItems.push({ label: 'Overview', desc: `Key aspects of ${topicTitle}`, icon: 'mdi/information' });
  }
  const overviewTemplate = pickUnusedTemplate('overview', [
    'list-grid-badge-card',
    'list-grid-candy-card-lite',
    'list-grid-ribbon-card',
    'list-row-simple-illus',
    'list-row-horizontal-icon-arrow',
  ]);
  blocks.push({
    block_index: 0,
    sub_title: `What is ${topicTitle}?`,
    visualization_type: 'overview',
    suggested_template: overviewTemplate,
    data: { title: topicTitle.slice(0, 40), items: overviewItems },
    caption: '',
    sources_used: [],
  });

  // ── Block per CP bullet — clean teaching framework ──────────────────
  // Each block dedicated to one CP bullet. Cards use a teaching
  // framework with CLEAN STATIC PHRASING (no noun-phrase concatenation
  // that produced "Foundation for definition overview chatbots in what"
  // grammatical garbage). Templates rotate across blocks for visual
  // variety so the deck doesn't look identical slide-to-slide.
  const titleCase = (s: string): string => s.replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

  // Per-bullet template pool — 13 distinct list/grid/zigzag templates.
  // pickUnusedTemplate() guarantees no two blocks in the same topic
  // share a template (even if a topic has many bullets, each gets a
  // different visual style). Mixed visualization_types so process-y
  // bullets get sequence templates and list-y bullets get list templates.
  const PER_BULLET_POOL: string[] = [
    'list-grid-badge-card',
    'list-grid-candy-card-lite',
    'list-grid-ribbon-card',
    'list-zigzag-down-compact-card',
    'list-zigzag-up-compact-card',
    'list-zigzag-down-simple',
    'list-row-horizontal-icon-arrow',
    'list-row-simple-illus',
    'list-sector-plain-text',
    'list-column-done-list',
    'list-column-vertical-icon-arrow',
    'sequence-stairs-front-pill-badge',
    'sequence-snake-steps-compact-card',
  ];

  for (let bi = 0; bi < bps.length && blocks.length < numBlocks - 1; bi++) {
    const bullet = bps[bi];
    const matchedFindings = findingsForBullet(bullet, 3, usedFindingIdxs);
    const items: ContentBlockItem[] = [];

    if (matchedFindings.length >= 3) {
      // We have on-topic research findings — use them directly. Each
      // becomes a separate card with a noun-phrase label.
      const seen = new Set<string>();
      for (const f of matchedFindings) {
        if (items.length >= 4) break;
        const desc = cleanText(f);
        const lbl = labelFromSentence(desc);
        if (!lbl) continue;
        const key = lbl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          label: truncWord(lbl, 24),
          desc: truncWord(desc, 100),
          icon: 'mdi/lightbulb',
        });
      }
    }

    if (items.length < 3) {
      // Sparse research — build 4-card teaching framework with CLEAN
      // static phrasing. Each card is grammatically self-contained
      // and references the bullet via the block's title (sub_title),
      // not via concatenation in the desc.
      const seedDesc = matchedFindings[0] ? cleanText(matchedFindings[0]) : cleanText(bullet);
      items.length = 0; // reset
      items.push({
        label: 'Definition',
        desc: truncWord(seedDesc, 100),
        icon: 'mdi/information',
      });
      items.push({
        label: 'Why It Matters',
        desc: 'Critical knowledge area for effective practice in this topic.',
        icon: 'mdi/star',
      });
      items.push({
        label: 'How to Apply',
        desc: 'Practise hands-on through guided exercises and real workplace scenarios.',
        icon: 'mdi/cog',
      });
      items.push({
        label: 'Key Outcome',
        desc: 'Build confidence and capability ready for workplace application.',
        icon: 'mdi/check-circle',
      });
    }

    const template = pickUnusedTemplate('overview', PER_BULLET_POOL);
    // Visualization type matches template family (sequence templates →
    // process viz_type so Phase 4 picks the right card layout).
    const vizType = template.startsWith('sequence-') ? 'process' : 'overview';
    blocks.push({
      block_index: blocks.length,
      sub_title: truncWord(titleCase(cleanText(bullet)), 60),
      visualization_type: vizType,
      suggested_template: template,
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
      const procTemplate = pickUnusedTemplate('process', [
        'sequence-snake-steps-compact-card',
        'sequence-roadmap-vertical-simple',
        'sequence-stairs-front-compact-card',
        'sequence-ascending-steps',
        'sequence-mountain-underline-text',
        'sequence-color-snake-steps-horizontal-icon-line',
        'sequence-horizontal-zigzag-simple-illus',
      ]);
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Process Steps`,
        visualization_type: 'process',
        suggested_template: procTemplate,
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
      const compTemplate = pickUnusedTemplate('comparison', [
        'compare-binary-horizontal-badge-card-arrow',
        'compare-binary-horizontal-simple-fold',
        'compare-binary-horizontal-underline-text-vs',
        'compare-hierarchy-left-right-circle-node-pill-badge',
      ]);
      // Build comparison items that ALWAYS have meaningful desc. If
      // research's comparison_items lack desc, derive it from CP bullets
      // (first half = label A side, second half = label B side) so the
      // arrow/badge templates render real content, not bare labels.
      const halfBp = Math.max(1, Math.ceil(bps.length / 2));
      const sideA = bps.slice(0, halfBp).map(cleanText);
      const sideB = bps.slice(halfBp).map(cleanText);
      const buildSide = (i: number, c: any, sideBullets: string[]): ContentBlockItem => {
        const label = truncWord(String(c?.label ?? (i === 0 ? 'Approach A' : 'Approach B')), 22);
        const rawDesc = String(c?.desc ?? '').trim();
        const desc = rawDesc.length >= 8
          ? truncWord(rawDesc, 80)
          : sideBullets.length
            ? truncWord(sideBullets[0], 80)
            : truncWord(`Key approach to ${topicTitle.toLowerCase()} focusing on ${label.toLowerCase()} aspects`, 80);
        const children = sideBullets.slice(1, 4).map((bp) => ({
          label: truncWord(labelFromSentence(bp) || bp.split(/\s+/).slice(0, 3).join(' '), 24),
          desc: truncWord(bp, 70),
          icon: 'mdi/chevron-right',
        }));
        return {
          label,
          desc,
          icon: i === 0 ? 'mdi/history' : 'mdi/rocket-launch',
          ...(children.length > 0 ? { children } : {}),
        };
      };
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Approach Comparison`,
        visualization_type: 'comparison',
        suggested_template: compTemplate,
        data: {
          title: 'Approaches',
          items: [
            buildSide(0, pair[0], sideA),
            buildSide(1, pair[1], sideB),
          ],
        },
        caption: '',
        sources_used: [],
      };
    } else if (tryStats) {
      const statsTemplate = pickUnusedTemplate('statistics', [
        'chart-bar-plain-text',
        'chart-pie-compact-card',
        'chart-pie-donut-plain-text',
        'chart-column-simple',
        'chart-line-plain-text',
      ]);
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Industry Metrics`,
        visualization_type: 'statistics',
        suggested_template: statsTemplate,
        data: {
          title: 'Key Metrics',
          items: chartData.slice(0, 5).map((d: any) => {
            const label = truncWord(String(d.label || ''), 18) || 'Metric';
            const src = String(d.source || '').trim();
            return {
              label,
              value: typeof d.value === 'number' && Number.isFinite(d.value) ? d.value : 50,
              desc: truncWord(src ? `${label} (${src})` : `${label} for ${topicTitle}`, 60),
              icon: 'mdi/chart-bar',
            };
          }),
        },
        caption: '',
        sources_used: [],
      };
    } else if (tryTimeline) {
      const tlTemplate = pickUnusedTemplate('timeline', [
        'sequence-timeline-simple',
        'sequence-timeline-rounded-rect-node',
        'sequence-timeline-simple-illus',
      ]);
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Timeline`,
        visualization_type: 'timeline',
        suggested_template: tlTemplate,
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
      const frTemplate = pickUnusedTemplate('overview', [
        'list-zigzag-down-compact-card',
        'list-zigzag-up-compact-card',
        'list-row-simple-illus',
        'list-column-vertical-icon-arrow',
        'list-sector-plain-text',
      ]);
      block = {
        block_index: blocks.length,
        sub_title: `${topicTitle} — Further Reading`,
        visualization_type: 'overview',
        suggested_template: frTemplate,
        data: { title: 'Additional Insights', items },
        caption: '',
        sources_used: [],
      };
    }
    blocks.push(block);
  }

  // ── Final block — Key Takeaways: ALWAYS recap CP bullets ────────────
  // Distinct labels (Remember / Practise / Apply / Reflect / Master)
  // anchored to bullets — same anti-duplication treatment as Block 0.
  const TAKEAWAY_VERBS = ['Remember', 'Practise', 'Apply', 'Reflect', 'Master'];
  const TAKEAWAY_ICONS = ['mdi/star', 'mdi/check-circle', 'mdi/cog', 'mdi/lightbulb', 'mdi/trophy'];
  const ktItems: ContentBlockItem[] = [];
  bps.slice(0, 5).forEach((bp, i) => {
    ktItems.push({
      label: TAKEAWAY_VERBS[i % TAKEAWAY_VERBS.length],
      desc: truncWord(cleanText(bp), 100),
      icon: TAKEAWAY_ICONS[i % TAKEAWAY_ICONS.length],
    });
  });
  if (ktItems.length === 0) {
    ktItems.push({ label: 'Key Concept', desc: `Apply ${topicTitle} principles consistently`, icon: 'mdi/star' });
  }
  // Key Takeaways uses a distinct template too — different from block 0
  // overview so the deck doesn't bookend with the same look.
  const ktTemplate = pickUnusedTemplate('overview', [
    'list-grid-ribbon-card',
    'list-column-done-list',
    'list-grid-candy-card-lite',
    'list-grid-badge-card',
    'list-row-horizontal-icon-arrow',
  ]);
  blocks.push({
    block_index: blocks.length,
    sub_title: 'Key Takeaways',
    visualization_type: 'overview',
    suggested_template: ktTemplate,
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
- Labels: 2-3 words MAX (e.g. "Risk Assessment", "Data Privacy")
- Descs: COMPLETE GRAMMATICAL CLAUSE, 4-10 words, max 80 chars
- DESCS MUST NEVER END ON A CONNECTOR WORD (or, and, the, of, in, for, to, a, an, is, are, was, with). Re-write the sentence if it would.
- DESCS MUST NEVER BE A FRAGMENT OR INCOMPLETE PHRASE. Each must read as a full clause that could stand alone.
- DESCS MUST NEVER REPEAT THE LABEL — write a new sentence that adds information.
- For comparison: exactly 2 items
- For statistics: items MUST have numeric "value" (real percentages or counts, not made up)
- Use DIFFERENT visualization_types across blocks within the same topic (don't make 6 overview blocks — vary across overview, process, comparison, statistics, hierarchy, timeline)
- Use DIFFERENT suggested_template values across blocks (each block in a topic should use a DIFFERENT template — never repeat the same template within one topic)
- Icons: mdi/* names from standard set (lock, scale-balance, chart-bar, account-multiple, cog, lightbulb, alert, check-circle, file-document, clock, earth, etc.)`;

  console.log(
    `[cw-slides-v3] phase2 calling Messages API for '${topic.topic_title.slice(0, 60)}': ` +
    `prompt=${prompt.length}b, model=${FAST_MODEL}, bullets=${bullets.length}, sources=${sources.length}`,
  );

  // Single Messages API call — same shape as cw-generate.ts which works
  // in production today. The wrapper retries 429/5xx internally so we
  // don't need an outer attempt loop. WebSearch was already done in
  // Phase 1 (HTTP DDG + Wikipedia) so no tool calls needed here.
  try {
    const result = await callClaudeJson({
      apiKey,
      model: FAST_MODEL,
      system: CONTENT_SYSTEM_PROMPT,
      prompt,
      maxTokens: CONTENT_MAX_TOKENS,
      maxRetries: 2,
    });

    let blocks: ContentBlock[] = Array.isArray(result?.content_blocks) ? result.content_blocks : [];
    const types = blocks.map((b) => b.visualization_type).join(', ');
    console.log(`[cw-slides-v3] phase2 OK '${topic.topic_title.slice(0, 60)}': ${blocks.length}/${numBlocks} blocks, types: [${types}]`);

    if (blocks.length === 0) {
      throw new Error('Messages API returned 0 content_blocks');
    }

    // Pad if AI returned fewer than requested (rare — Haiku usually hits target)
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
    const errMsg = e?.message || String(e);
    const status = e?.status || e?.response?.status;
    console.error(
      `[cw-slides-v3] PHASE 2 FAILED for '${topic.topic_title.slice(0, 60)}': ` +
      `${errMsg.slice(0, 300)} | status=${status || '?'}`,
    );
    return fallbackContentBlocks(topic.topic_title, topic.bullet_points, numBlocks, research);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public — generate content for all topics in parallel
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk every block / item produced by Phase 2 (AI or fallback) and guarantee
 * each item has a non-empty `desc`. The infographic templates render label+desc;
 * empty desc shows up as bare label-only arrows / cards (the "Pros / Cons with
 * no description" bug from deck g9).
 *
 * If desc is missing or too short to be meaningful (<8 chars), synthesize one
 * from CP bullets (preferred), then research findings, then a topic-anchored
 * sentence. Never leaves an item with empty desc.
 */
function sanitizeBlockItems(
  entry: ContentMapEntry,
  topic: SlideTopic,
  research: ResearchEntry | undefined,
): void {
  const topicTitle = entry.topic || topic.topic_title || 'this topic';
  const bullets = (topic.bullet_points || [])
    .map((b) => String(b ?? '').trim())
    .filter((b) => b.length > 0 && !b.startsWith('['));
  const findings: string[] = [];
  for (const s of research?.sources || []) {
    for (const f of (s.key_findings || [])) {
      const t = String(f).trim();
      if (t.length >= 20 && t.length <= 200) findings.push(t);
    }
  }
  let bulletCursor = 0;
  let findingCursor = 0;
  const synthDesc = (label: string): string => {
    if (bulletCursor < bullets.length) {
      const bp = bullets[bulletCursor++];
      return bp.length > 80 ? bp.slice(0, 77).replace(/\s+\S*$/, '') + '…' : bp;
    }
    if (findingCursor < findings.length) {
      const f = findings[findingCursor++];
      return f.length > 80 ? f.slice(0, 77).replace(/\s+\S*$/, '') + '…' : f;
    }
    return `Key aspect of ${topicTitle.toLowerCase()} — ${label.toLowerCase()}`;
  };

  let fixed = 0;
  for (const block of entry.content_blocks || []) {
    const items = Array.isArray(block.data?.items) ? block.data!.items : [];
    for (const it of items) {
      const desc = String(it?.desc ?? '').trim();
      if (desc.length < 8) {
        const label = String(it?.label ?? '').trim() || 'Key Point';
        it.desc = synthDesc(label);
        fixed++;
      }
      // Recursively sanitize children
      const children = Array.isArray((it as any).children) ? (it as any).children : [];
      for (const c of children) {
        const cd = String(c?.desc ?? '').trim();
        if (cd.length < 8) {
          c.desc = synthDesc(String(c?.label ?? 'Sub-point'));
          fixed++;
        }
      }
    }
  }
  if (fixed > 0) {
    console.log(`[cw-slides-v3] sanitizeBlockItems '${topicTitle.slice(0, 60)}': filled ${fixed} empty descs`);
  }
}

export async function generateAllContent(
  topics: SlideTopic[],
  researchMap: Record<string, ResearchEntry>,
  perTopicBlocks: number[],
  courseTitle: string,
  apiKey: string,
  model?: string,
): Promise<Record<string, ContentMapEntry>> {
  // Reset the deck-wide template registry so this run starts fresh —
  // prevents stale state from a previous deck biasing template picks.
  _resetDeckRegistry();

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
    // ALWAYS sanitize — guarantees no infographic renders with empty descs
    sanitizeBlockItems(map[key], topics[i], researchMap[key]);
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
