/**
 * Infographic agent — pure TypeScript port of
 * scripts/courseware_agents/slides/infographic_agent.py
 *
 * For each content block:
 *   1. Build AntV Infographic JSON options (deterministic — no AI call)
 *   2. Write self-contained HTML that inlines the AntV runtime
 *   3. Use Playwright Chromium to render the HTML as a 1792x1024 PNG
 *
 * The AntV runtime (infographic.min.js, ~864 KB) is inlined into each
 * HTML file so the page works under file:// without any network/CORS issues.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { type Browser } from 'playwright';
import { launchHardenedChromium } from './chromium-launch';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const ANTV_SCRIPT_PATH = path.join(
  process.cwd(),
  'scripts',
  'courseware_agents',
  'slides',
  'templates',
  'infographic.min.js',
);

const CANVAS_W = 1792;
const CANVAS_H = 1024;
// A fully-rendered AntV infographic at 1792x1024 with real SVG content
// produces 30-400 KB PNGs. Streamlit reference accepts down to 10 KB —
// some sparse infographics (single-item hierarchy, tiny stats) legitimately
// land in the 11-19 KB band. Match Python's threshold to avoid throwing
// away valid renders.
const MIN_PNG_BYTES = 10_000;
const MAX_PAGES_PER_BROWSER = 8;

const DEFAULT_ICONS = [
  'mdi/lightbulb', 'mdi/check-circle', 'mdi/star', 'mdi/shield-check',
  'mdi/cog', 'mdi/chart-line', 'mdi/book-open', 'mdi/account-group',
];

// Icons we know the model + DSL builder use frequently. Pre-fetched once
// at module init and inlined into the AntV HTML so the page reads them
// from a local JS map instead of fetching from iconify.design per render.
//
// Without this cache, the AntV resource loader fires a network request per
// icon per slide. ~6 icons × ~80 infographic slides = 480 sequential network
// calls inside Playwright Chromium pages, each capped at 2s — when the CDN
// is slow or rate-limits, icons silently fail to load and slides render as
// empty placeholder boxes (the user-visible bug).
const COMMON_ICONS: string[] = [
  ...DEFAULT_ICONS,
  // Generic concept icons the content prompt + padContentBlocks use
  'mdi/information', 'mdi/chevron-right', 'mdi/check', 'mdi/close',
  'mdi/alert-circle', 'mdi/alert', 'mdi/help-circle', 'mdi/clipboard-text',
  'mdi/clipboard-check', 'mdi/shield', 'mdi/scale-balance', 'mdi/lock',
  'mdi/lock-open', 'mdi/key', 'mdi/eye', 'mdi/eye-off',
  // Process / time / measurement
  'mdi/clock', 'mdi/clock-outline', 'mdi/timer', 'mdi/calendar',
  'mdi/trending-up', 'mdi/trending-down', 'mdi/chart-bar', 'mdi/chart-pie',
  'mdi/currency-usd', 'mdi/percent',
  // Tech / industry
  'mdi/rocket-launch', 'mdi/history', 'mdi/database', 'mdi/cloud',
  'mdi/server', 'mdi/laptop', 'mdi/cellphone', 'mdi/wifi',
  'mdi/api', 'mdi/code-tags', 'mdi/web',
  // People / org
  'mdi/account', 'mdi/account-multiple', 'mdi/account-tie', 'mdi/handshake',
  'mdi/domain', 'mdi/office-building', 'mdi/briefcase', 'mdi/email',
  // Quality / docs
  'mdi/file-document', 'mdi/file-check', 'mdi/file-search', 'mdi/note-text',
  'mdi/format-list-bulleted', 'mdi/format-list-numbered', 'mdi/checkbox-marked',
  // Direction / flow
  'mdi/arrow-right', 'mdi/arrow-left', 'mdi/arrow-up', 'mdi/arrow-down',
  'mdi/arrow-right-thick', 'mdi/swap-horizontal', 'mdi/refresh', 'mdi/reload',
  // Special concepts
  'mdi/heart', 'mdi/thumb-up', 'mdi/thumb-down', 'mdi/flag',
  'mdi/medal', 'mdi/trophy', 'mdi/diamond', 'mdi/fire',
  'mdi/leaf', 'mdi/earth', 'mdi/recycle', 'mdi/sprout',
];

// Module-level cache, primed on first access from the bundled JSON file
// at lib/cw-slides-icon-cache.json. Pre-fetched at build/dev time via
// `npx tsx scripts/prefetch-icons.ts` and committed as a static asset
// so production has ZERO network calls to iconify.design at runtime.
//
// Earlier versions tried to fetch at module init — that worked locally
// but failed in the Coolify container (slow / blocked egress to iconify),
// leaving most infographics with empty placeholder squares. With the
// static bundle, icons render reliably regardless of container network.
const iconCache = new Map<string, string>();
let iconCacheLoaded = false;

async function ensureIconCache(): Promise<void> {
  if (iconCacheLoaded) return;
  iconCacheLoaded = true;
  try {
    const cachePath = path.join(process.cwd(), 'lib', 'cw-slides-icon-cache.json');
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim().startsWith('<svg')) {
        iconCache.set(k, v);
      }
    }
    console.log(`[cw-slides-infographic] loaded ${iconCache.size} icons from static bundle`);
  } catch (e: any) {
    console.warn('[cw-slides-infographic] static icon bundle missing — icons may not render. Run: npx tsx scripts/prefetch-icons.ts');
  }
}

// Keyword → cached-icon map used for both (a) snapping a model-supplied
// icon name and (b) deriving an icon from a card's label/desc when no
// usable name was supplied. Order matters (more specific first).
const ICON_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/\b(privacy|anonymis|de-identif|encrypt|protect|gdpr|pdpa|confiden)/i, 'mdi/lock'],
  [/\b(security|secure|defend|breach|threat|attack)/i, 'mdi/shield'],
  [/\b(ethic|fair|bias|moral|accountab|responsib|trust)/i, 'mdi/scale-balance'],
  [/\b(database|sql|table|query|record|datastore)/i, 'mdi/database'],
  [/\bdata\b/i, 'mdi/database'],
  [/\b(cloud|aws|azure|gcp|saas|paas)/i, 'mdi/cloud'],
  [/\b(server|host|backend|infra|deploy)/i, 'mdi/server'],
  [/\b(code|programming|develop|script|python|java|api|sdk)/i, 'mdi/code-tags'],
  [/\b(machine learning|deep learning|neural|llm|gpt|model|algorithm|ai\b)/i, 'mdi/lightbulb'],
  [/\b(web|http|browser|url|website)/i, 'mdi/web'],
  [/\b(email|mail|notify|message)/i, 'mdi/email'],
  [/\b(account|user|person|people|team|staff|stakeholder|role|practitioner|developer|engineer|trainer|learner)/i, 'mdi/account-multiple'],
  [/\b(business|company|org|enterprise|corporate|industry|commercial)/i, 'mdi/office-building'],
  [/\b(money|cost|price|finance|budget|usd|salary|fund|invest)/i, 'mdi/currency-usd'],
  [/\b(percent|rate|metric|kpi|score|indicator)/i, 'mdi/percent'],
  [/\b(chart|graph|stat|analytic|measure|measurement)/i, 'mdi/chart-bar'],
  [/\b(trend|growth|increase|up|adoption|scale|expand)/i, 'mdi/trending-up'],
  [/\b(decline|down|decrease|drop|reduce|cut)/i, 'mdi/trending-down'],
  [/\b(time|clock|hour|minute|deadline|schedule|duration)/i, 'mdi/clock'],
  [/\b(calendar|date|day|week|month|year|history|past)/i, 'mdi/calendar'],
  [/\b(check|verify|validate|approve|complete|done|compliance|compliant|standard|conform)/i, 'mdi/check-circle'],
  [/\b(cancel|reject|fail|error|wrong)/i, 'mdi/close'],
  [/\b(warn|alert|caution|risk|hazard|danger|incident|issue|concern|pitfall)/i, 'mdi/alert'],
  [/\b(help|support|question|inquir|guide)/i, 'mdi/help-circle'],
  [/\b(doc|document|file|paper|report|policy|guidelin|regulation)/i, 'mdi/file-document'],
  [/\b(list|bullet|item|inventory|catalog)/i, 'mdi/format-list-bulleted'],
  [/\b(idea|insight|innovate|tip|bulb|concept|principle)/i, 'mdi/lightbulb'],
  [/\b(process|step|workflow|flow|procedure|method|stage|phase|pipeline)/i, 'mdi/refresh'],
  [/\b(arrow|next|continue|forward|proceed)/i, 'mdi/arrow-right'],
  [/\b(star|favorite|highlight|key|important|priority|critical)/i, 'mdi/star'],
  [/\b(heart|love|care|wellness|wellbeing|welfare|impact)/i, 'mdi/heart'],
  [/\b(leaf|green|environment|eco|sustainability|carbon|climate)/i, 'mdi/leaf'],
  [/\b(earth|world|global|planet|context|scope|reach)/i, 'mdi/earth'],
  [/\b(rocket|launch|deploy|release|modern|future|emerging|advanced)/i, 'mdi/rocket-launch'],
  [/\b(cog|setting|config|tool|gear|implement|operate)/i, 'mdi/cog'],
  [/\b(info|about|describe|note|definition|overview)/i, 'mdi/information'],
  [/\b(book|learn|train|education|course|knowledge|study)/i, 'mdi/book-open'],
  [/\b(handshake|partner|deal|agreement|collab)/i, 'mdi/handshake'],
  [/\b(trophy|award|win|achieve|success|outcome|benefit|reward)/i, 'mdi/trophy'],
  [/\b(flag|milestone|goal|target|objective|aim)/i, 'mdi/flag'],
  [/\b(plan|design|architect|blueprint|strategy)/i, 'mdi/clipboard-text'],
  [/\b(review|assess|evaluate|audit|monitor|inspect|examine)/i, 'mdi/file-search'],
  [/\b(eye|visib|observ|watch|monitor)/i, 'mdi/eye'],
];

// Snap an arbitrary icon name to the closest cached icon, OR if no
// usable name is supplied, derive one from the card's label/desc.
//
// CRITICAL: every value returned here MUST be a key that exists in
// iconCache. The AntV page renders icons by looking them up in
// __ICON_CACHE__; a name that isn't cached renders as an empty circle.
// Hence we wrap every keyword-map result in `pickIfCached()` and fall
// back to a known-cached default if the keyword target isn't bundled.
function snapToCachedIcon(name: string | undefined, fallbackIdx: number, contextText?: string): string {
  const pickIfCached = (n: string | undefined): string | null => {
    if (!n) return null;
    if (iconCache.has(n)) return n;
    const cleaned = n.replace(/^mdi-/, 'mdi/').replace(/_/g, '-');
    if (iconCache.has(cleaned)) return cleaned;
    return null;
  };
  // 1) Direct cache hit on supplied name
  const direct = pickIfCached(name);
  if (direct) return direct;
  // 2) Keyword-map the supplied name
  if (name && typeof name === 'string') {
    for (const [re, cached] of ICON_KEYWORD_MAP) {
      if (re.test(name.toLowerCase())) {
        const hit = pickIfCached(cached);
        if (hit) return hit;
      }
    }
  }
  // 3) Keyword-map the card's content text (label + desc)
  if (contextText && typeof contextText === 'string') {
    for (const [re, cached] of ICON_KEYWORD_MAP) {
      if (re.test(contextText)) {
        const hit = pickIfCached(cached);
        if (hit) return hit;
      }
    }
  }
  // 4) Rotate through COMMON_ICONS by index. Filter to only icons that
  //    are actually in the cache, so the final fallback can never miss.
  for (let off = 0; off < COMMON_ICONS.length; off++) {
    const candidate = COMMON_ICONS[(fallbackIdx + off) % COMMON_ICONS.length];
    const hit = pickIfCached(candidate);
    if (hit) return hit;
  }
  return 'mdi/lightbulb';
}

function iconCacheToJson(): string {
  // Build a JS object literal so the AntV page can look up icons by name.
  const obj: Record<string, string> = {};
  for (const [k, v] of iconCache.entries()) obj[k] = v;
  return JSON.stringify(obj);
}

export const TEMPLATE_MAP: Record<string, string[]> = {
  overview: [
    'list-grid-badge-card',
    'list-grid-candy-card-lite',
    'list-grid-ribbon-card',
    'list-zigzag-down-compact-card',
    'list-zigzag-up-compact-card',
    'list-zigzag-down-simple',
    'list-zigzag-up-simple',
    'list-row-horizontal-icon-arrow',
    'list-row-simple-illus',
    'list-sector-plain-text',
    'list-column-done-list',
    'list-column-vertical-icon-arrow',
    'list-column-simple-vertical-arrow',
  ],
  process: [
    'sequence-snake-steps-compact-card',
    'sequence-snake-steps-simple',
    'sequence-snake-steps-underline-text',
    'sequence-roadmap-vertical-simple',
    'sequence-roadmap-vertical-plain-text',
    'sequence-stairs-front-compact-card',
    'sequence-stairs-front-pill-badge',
    'sequence-ascending-steps',
    'sequence-ascending-stairs-3d-underline-text',
    'sequence-color-snake-steps-horizontal-icon-line',
    'sequence-horizontal-zigzag-underline-text',
    'sequence-horizontal-zigzag-simple-illus',
    'sequence-zigzag-steps-underline-text',
    'sequence-mountain-underline-text',
    'sequence-filter-mesh-simple',
  ],
  comparison: [
    'compare-binary-horizontal-badge-card-arrow',
    'compare-binary-horizontal-simple-fold',
    'compare-binary-horizontal-underline-text-vs',
    'compare-hierarchy-left-right-circle-node-pill-badge',
    'compare-swot',
  ],
  cycle: [
    'sequence-circular-simple',
    'sequence-pyramid-simple',
    'sequence-cylinders-3d-simple',
    'sequence-zigzag-pucks-3d-simple',
  ],
  hierarchy: [
    'hierarchy-tree-curved-line-rounded-rect-node',
    'hierarchy-tree-tech-style-badge-card',
    'hierarchy-tree-tech-style-capsule-item',
    'hierarchy-structure',
  ],
  statistics: [
    // chart-wordcloud removed — see SKELETON_TEMPLATE_MAP in cw-slides.ts
    // (renders as floating labels with no values; useless for training).
    'chart-pie-compact-card',
    'chart-pie-plain-text',
    'chart-pie-donut-plain-text',
    'chart-pie-donut-pill-badge',
    'chart-bar-plain-text',
    'chart-column-simple',
    'chart-line-plain-text',
  ],
  timeline: [
    'sequence-timeline-simple',
    'sequence-timeline-rounded-rect-node',
    'sequence-timeline-simple-illus',
    'sequence-roadmap-vertical-simple',
  ],
  relationship: [
    'relation-circle-icon-badge',
    'relation-circle-circular-progress',
  ],
  quadrant: [
    'quadrant-quarter-simple-card',
    'quadrant-quarter-circular',
    'quadrant-simple-illus',
  ],
};

const FALLBACK_TEMPLATES = [
  'list-grid-badge-card',
  'list-grid-candy-card-lite',
  'list-row-horizontal-icon-arrow',
  'list-column-done-list',
];

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface ContentBlockItem {
  label?: string;
  desc?: string;
  icon?: string;
  value?: number;
  children?: ContentBlockItem[];
}

export interface ContentBlock {
  sub_title?: string;
  visualization_type?: string;
  suggested_template?: string;
  caption?: string;
  data?: {
    title?: string;
    desc?: string;
    items?: ContentBlockItem[];
  };
}

export interface InfographicAssignment {
  slide_position: number;
  content_block_index: number;
  sub_title?: string;
  visualization_type?: string;
  assigned_template?: string;
}

export interface InfographicSkeletonTopic {
  topic_title: string;
  infographic_assignments: InfographicAssignment[];
}

export interface InfographicSkeletonLu {
  topics: InfographicSkeletonTopic[];
}

export interface InfographicSkeletonLo {
  learning_units: InfographicSkeletonLu[];
}

export interface InfographicSkeleton {
  learning_outcomes: InfographicSkeletonLo[];
}

export interface InfographicContentEntry {
  content_blocks: ContentBlock[];
}

export interface InfographicResult {
  topic: string;
  slide_position: number;
  sub_title?: string;
  visualization_type?: string;
  template_used?: string;
  caption?: string;
  html_path?: string;
  image_path?: string | null;
  generated: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic AntV DSL builder — mirrors build_antv_dsl() in Python
// ────────────────────────────────────────────────────────────────────────────

// Trailing-word stop list — words that should NEVER end a truncated
// description because they leave the reader hanging mid-clause:
//   "Truth is conformity to reality or"          → "Truth is conformity to reality"
//   "It outlined four core ethical principles in"→ "It outlined four core ethical principles"
//   "OCR issued guidance on the ethical use of"  → "OCR issued guidance on the ethical use"
const TRAILING_DROP = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','from','for','by','with',
  'as','is','are','was','were','be','been','being','that','which','this','these','those',
  'it','its','their','his','her','our','your','my','than','then','also','such','about',
  'into','onto','upon','via','per','no','not','if','when','where','while',
]);

function truncateAtWord(text: string, maxLen: number): string {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (trimmed.length <= maxLen) {
    // Even if the input fits, drop a trailing connector that leaves a
    // dangling clause. Wikipedia summaries often hand us phrases like
    // "intelligence covers a broad range of" — same problem.
    return stripTrailingConnectors(trimmed);
  }
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  let result: string;
  if (lastSpace >= 4) result = cut.slice(0, lastSpace);
  else result = cut;
  return stripTrailingConnectors(result.replace(/[.,;:\-]+$/, ''));
}

function stripTrailingConnectors(s: string): string {
  let out = s.trim().replace(/[.,;:\-]+$/, '');
  // Drop up to 3 trailing stop-words. e.g. "exceed or augment" survives
  // (augment isn't a stop word) but "scope of" → "scope" and
  // "matters in" → "matters".
  for (let i = 0; i < 3; i++) {
    const m = out.match(/^(.*?)\s+([A-Za-z']+)\s*$/);
    if (!m) break;
    if (!TRAILING_DROP.has(m[2].toLowerCase())) break;
    out = m[1].trim();
  }
  return out.replace(/[.,;:\-]+$/, '');
}

// Template-specific text limits — mirrors _enforce_dsl_text_limits() in
// infographic_agent.py. Different templates have very different text zones;
// using uniform limits (as I was before) causes horizontal-sequence and
// chart templates to crop.
function templateLimits(template: string): {
  labelMax: number;
  descMax: number;
  titleMax: number;
  topDescMax: number;
  maxItems: number;
} {
  const isChart = template.startsWith('chart-');
  const isSequence = template.startsWith('sequence-') || template.startsWith('list-zigzag');
  const isHorizontal = /horizontal|snake|ascending|stairs|color-snake/.test(template);
  const isCompare = template.startsWith('compare-');
  const isList = template.startsWith('list-');
  const isGrid = /grid/.test(template);
  const isColumn = /column|done-list/.test(template);
  const isRow = /row/.test(template);

  // Tightened limits to prevent text overlap on AntV-rendered infographics.
  // Earlier limits were too generous — long labels/descs would overflow
  // their text zones and overlap neighbouring elements. Per AntV template
  // visual inspection, these caps keep text inside the design boxes.
  // Limits match Streamlit's infographic_agent._enforce_dsl_text_limits
  // (lines 203-227 of infographic_agent.py). Generous so common phrases
  // don't truncate mid-word.
  if (isChart) {
    return { labelMax: 18, descMax: 0, titleMax: 45, topDescMax: 60, maxItems: 4 };
  }
  if (isSequence && isHorizontal) {
    return { labelMax: 20, descMax: 35, titleMax: 45, topDescMax: 55, maxItems: 3 };
  }
  if (isSequence) {
    return { labelMax: 22, descMax: 45, titleMax: 45, topDescMax: 60, maxItems: 4 };
  }
  if (isCompare) {
    return { labelMax: 22, descMax: 45, titleMax: 45, topDescMax: 55, maxItems: 4 };
  }
  if (isList || isGrid || isColumn || isRow) {
    return { labelMax: 28, descMax: 55, titleMax: 50, topDescMax: 65, maxItems: 5 };
  }
  return { labelMax: 25, descMax: 50, titleMax: 45, topDescMax: 60, maxItems: 5 };
}

// Detect sparse content that would render as an empty-looking compare or
// chart infographic (just icons + short labels with no supporting text).
// When detected, the caller downgrades the template to a list-grid variant
// that shows labels prominently as cards.
function isContentThin(items: ContentBlockItem[]): boolean {
  if (!items.length) return true;
  const hasAnyDesc = items.filter((it) => (it?.desc ?? '').toString().trim().length > 8).length;
  const hasAnyChildren = items.some(
    (it) => Array.isArray(it?.children) && it!.children!.length > 0,
  );
  const hasNumericValues = items.some((it) => typeof it?.value === 'number');
  // "Thin" if fewer than 2 items with real descriptions AND no children AND no numeric values
  return hasAnyDesc < 2 && !hasAnyChildren && !hasNumericValues;
}

export function buildAntvDsl(block: ContentBlock, template: string): string {
  const blockData = block?.data ?? {};
  const rawItems = Array.isArray(blockData.items) ? blockData.items : [];

  // If content is too thin for a compare/chart template, downgrade to a
  // list-grid variant so labels still show as prominent cards rather than
  // two bare icons.
  if ((template.startsWith('compare-') || template.startsWith('chart-')) && isContentThin(rawItems)) {
    template = rawItems.length <= 3 ? 'list-grid-badge-card' : 'list-row-horizontal-icon-arrow';
  }

  const limits = templateLimits(template);
  const title = truncateAtWord(blockData.title ?? '', limits.titleMax);
  let items = [...rawItems];
  items = items.slice(0, limits.maxItems);

  const isChart = template.startsWith('chart-');
  const isCompare = template.startsWith('compare-');

  const contextDesc = String(blockData.desc ?? blockData.title ?? '').trim();

  const jsonItems: any[] = items.map((raw, i) => {
    const label = truncateAtWord(raw?.label ?? `Point ${i + 1}`, limits.labelMax);
    const entry: any = { label };
    const rawDesc = String(raw?.desc ?? '').trim();
    // Charts: no desc (causes overflow under bars). Others: per-template limit.
    if (limits.descMax > 0) {
      if (rawDesc) {
        entry.desc = truncateAtWord(rawDesc, limits.descMax);
      } else if (contextDesc) {
        // Synthesize a minimal desc from block context so cards aren't empty.
        entry.desc = truncateAtWord(contextDesc, limits.descMax);
      }
    }
    // Snap any model-picked icon to a guaranteed-cached one so it always
    // renders in production. Pass label+desc as context so cards without
    // an explicit icon name still get a content-relevant glyph instead
    // of all sharing the same default.
    const ctxText = `${raw?.label ?? ''} ${raw?.desc ?? ''} ${contextDesc}`.toLowerCase();
    entry.icon = snapToCachedIcon(raw?.icon, i, ctxText);

    if (isChart) {
      let value: any = raw?.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        const parsed = Number(value);
        value = Number.isFinite(parsed) && parsed > 0 ? parsed : (i + 1) * 20;
      }
      entry.value = value;
    }

    const children = Array.isArray(raw?.children) ? raw!.children!.slice(0, 3) : [];
    if (children.length) {
      entry.children = children.map((c, ci) => {
        const childCtx = `${c?.label ?? ''} ${c?.desc ?? ''} ${contextDesc}`.toLowerCase();
        const childEntry: any = {
          label: truncateAtWord(c?.label ?? `Sub ${ci + 1}`, Math.min(25, limits.labelMax)),
          icon: snapToCachedIcon(c?.icon, ci, childCtx),
        };
        if (c?.desc) childEntry.desc = truncateAtWord(c.desc, Math.min(40, limits.descMax || 40));
        return childEntry;
      });
    }
    return entry;
  });

  // compare-* templates: fold N items into exactly 2 root items with children
  let finalItems = jsonItems;
  if (isCompare && jsonItems.length >= 2) {
    const mid = Math.max(1, Math.floor(jsonItems.length / 2));
    const a = jsonItems.slice(0, mid);
    const b = jsonItems.slice(mid);
    const rootA: any = { ...a[0] };
    if (a.length > 1) rootA.children = a.slice(1);
    const rootB: any = { ...b[0] };
    if (b.length > 1) rootB.children = b.slice(1);
    finalItems = [rootA, rootB];
  }

  const options = {
    template,
    title: { text: title || 'Infographic' },
    data: { items: finalItems },
  };
  return JSON.stringify(options);
}

// ────────────────────────────────────────────────────────────────────────────
// HTML template (inlines AntV runtime so file:// works without network)
// ────────────────────────────────────────────────────────────────────────────

let _antvScriptCache: string | null = null;
let _antvScriptWarned = false;

function getAntvScript(): string {
  if (_antvScriptCache !== null) return _antvScriptCache;
  try {
    _antvScriptCache = fs.readFileSync(ANTV_SCRIPT_PATH, 'utf-8');
  } catch {
    _antvScriptCache = '';
  }
  if (!_antvScriptCache && !_antvScriptWarned) {
    console.warn(
      `[cw-slides-infographic] AntV runtime not found at ${ANTV_SCRIPT_PATH} — ` +
      `falling back to CDN (requires internet) or plain-HTML renderer.`,
    );
    _antvScriptWarned = true;
  }
  return _antvScriptCache;
}

function safeFilename(title: string): string {
  const safe = title.replace(/ /g, '_').replace(/[/\\]/g, '-');
  return safe.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 30) || 'topic';
}

function escHtml(s: string): string {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ────────────────────────────────────────────────────────────────────────────
// Plain-HTML card-grid fallback renderer — no AntV dependency.
// Used when all AntV attempts fail, so we ALWAYS produce an infographic PNG
// instead of silently falling back to a text-bullet slide.
// ────────────────────────────────────────────────────────────────────────────

const PLAIN_PALETTE = [
  '#3498DB', '#1ABC9C', '#E74C3C', '#F39C12',
  '#9B59B6', '#27AE60', '#2C3E50', '#E67E22',
];

function escText(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writePlainCardHtml(htmlPath: string, block: ContentBlock, template: string): void {
  const viz = block.visualization_type || 'overview';
  const blockTitle = block.data?.title || block.sub_title || 'Infographic';
  const blockDesc = block.data?.desc || '';
  let items = Array.isArray(block.data?.items) ? [...block.data!.items!] : [];
  if (viz === 'comparison' && items.length > 4) items = items.slice(0, 4);
  else if (viz === 'statistics') items = items.slice(0, 5);
  else items = items.slice(0, 6);
  if (!items.length) items = [{ label: 'Key Point', desc: blockTitle }];

  const isStats = viz === 'statistics' || template.startsWith('chart-');
  const isProcess = viz === 'process' || template.startsWith('sequence-');
  const isCompare = viz === 'comparison' || template.startsWith('compare-');

  const cards = items
    .map((it, i) => {
      const color = PLAIN_PALETTE[i % PLAIN_PALETTE.length];
      const label = escText(it.label || `Item ${i + 1}`);
      const desc = escText(it.desc || '');
      const value = typeof it.value === 'number' ? it.value : null;
      const step = isProcess ? `<div class="step">Step ${i + 1}</div>` : '';

      if (isStats && value != null) {
        return `<div class="card stat" style="border-top-color:${color}">
          ${step}
          <div class="stat-value" style="color:${color}">${value}${typeof value === 'number' && value <= 100 ? '%' : ''}</div>
          <div class="card-label">${label}</div>
          ${desc ? `<div class="card-desc">${desc}</div>` : ''}
        </div>`;
      }
      return `<div class="card" style="border-top-color:${color}">
        ${step}
        <div class="card-label" style="color:${color}">${label}</div>
        ${desc ? `<div class="card-desc">${desc}</div>` : ''}
      </div>`;
    })
    .join('\n');

  const gridCols = isCompare ? 2 : items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escText(blockTitle)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', 'Arial', sans-serif; }
    body { background: #FFFFFF; width: ${CANVAS_W}px; height: ${CANVAS_H}px; padding: 60px 80px; }
    .wrap { display: flex; flex-direction: column; height: 100%; }
    h1 { color: #1B2A4A; font-size: 48px; font-weight: 700; margin-bottom: 12px; line-height: 1.15; }
    .subtitle { color: #666; font-size: 22px; margin-bottom: 40px; font-style: italic; }
    .grid { display: grid; gap: 32px; flex: 1; grid-template-columns: repeat(${gridCols}, 1fr); align-content: start; }
    .card {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-top: 8px solid #3498DB;
      border-radius: 12px;
      padding: 32px 28px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.06);
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      min-height: 220px;
    }
    .card.stat { align-items: center; text-align: center; justify-content: center; }
    .step {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #999;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .card-label { font-size: 28px; font-weight: 700; color: #1B2A4A; line-height: 1.2; margin-bottom: 12px; }
    .card-desc { font-size: 20px; color: #555; line-height: 1.5; }
    .stat-value { font-size: 88px; font-weight: 800; line-height: 1; margin-bottom: 16px; }
    .teal-bar { height: 6px; background: #1ABC9C; border-radius: 3px; width: 160px; margin-bottom: 28px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escText(blockTitle)}</h1>
    <div class="teal-bar"></div>
    ${blockDesc ? `<div class="subtitle">${escText(blockDesc)}</div>` : ''}
    <div class="grid">${cards}</div>
  </div>
  <script>window.__RENDERED__ = true;</script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, 'utf-8');
}

function writeAntvHtml(htmlPath: string, optionsJson: string, title: string): void {
  const antvJs = getAntvScript();
  const scriptTag = antvJs
    ? `<script>${antvJs}</script>`
    : `<script src="https://unpkg.com/@antv/infographic@0.2.15/dist/infographic.min.js"></script>`;

  // Inline the pre-fetched icon cache as a global JS object. The page's
  // resource loader checks this map first and only falls back to a network
  // fetch for icons we haven't pre-fetched.
  const iconCacheJson = iconCacheToJson();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escHtml(title)} - Infographic</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #FFFFFF; }
    #container { width: ${CANVAS_W}px; min-height: ${CANVAS_H}px; }
    #container svg { width: ${CANVAS_W}px !important; height: ${CANVAS_H}px !important; }
  </style>
</head>
<body>
  <div id="container"></div>
  ${scriptTag}
  <script>
    // Pre-fetched icon SVGs, indexed by name (e.g. "mdi/lightbulb"). Anything
    // in this map renders synchronously without a network call — the previous
    // implementation hit iconify.design per icon per slide and the user-visible
    // bug was empty placeholder boxes whenever those calls timed out.
    window.__ICON_CACHE__ = ${iconCacheJson};
    if (typeof AntVInfographic !== 'undefined') {
      AntVInfographic.registerResourceLoader(async (config) => {
        const { data, scene } = config;
        try {
          // Local cache hit — most common path now.
          if (scene === 'icon' && window.__ICON_CACHE__ && window.__ICON_CACHE__[data]) {
            return AntVInfographic.loadSVGResource(window.__ICON_CACHE__[data]);
          }
          let url;
          if (scene === 'icon') url = 'https://api.iconify.design/' + data + '.svg';
          else if (scene === 'illus') url = 'https://raw.githubusercontent.com/balazser/undraw-svg-collection/refs/heads/main/svgs/' + data + '.svg';
          else return null;
          const controller = new AbortController();
          // Bumped 2s → 5s for slower production network paths.
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const r = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller.signal });
          clearTimeout(timeoutId);
          if (!r.ok) return null;
          const text = await r.text();
          if (!text || !text.trim().startsWith('<svg')) return null;
          // Cache the network-fetched icon for subsequent renders in the
          // same page (rare — pages usually render one infographic each).
          if (scene === 'icon' && window.__ICON_CACHE__) window.__ICON_CACHE__[data] = text;
          return AntVInfographic.loadSVGResource(text);
        } catch (e) { return null; }
      });
    }
  </script>
  <script>
    window.__RENDERED__ = false;
    window.__HAS_SVG__ = false;
    window.__RENDER_ERROR__ = null;
    (async () => {
      try {
        if (typeof AntVInfographic === 'undefined') {
          throw new Error('AntVInfographic runtime not loaded');
        }
        const ig = new AntVInfographic.Infographic({
          container: '#container',
          width: ${CANVAS_W},
          height: ${CANVAS_H},
        });
        const opts = ${optionsJson};
        ig.setOptions(opts);
        ig.performRender();
        // Give icons up to 3s to settle
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 500));
          try { ig.performRender(); } catch(e) {}
          const svg = document.querySelector('#container svg');
          if (svg && svg.innerHTML.length > 500) {
            window.__HAS_SVG__ = true;
          }
        }
        // Final render pass
        try { ig.performRender(); } catch(e) {}
      } catch (e) {
        window.__RENDER_ERROR__ = String(e && (e.stack || e.message || e));
        console.error('AntV render error:', e);
      } finally {
        // Check SVG content one more time
        const svg = document.querySelector('#container svg');
        if (svg && svg.innerHTML.length > 500) window.__HAS_SVG__ = true;
        window.__RENDERED__ = true;
      }
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────────
// Playwright screenshot — matches _html_to_png() in Python
// ────────────────────────────────────────────────────────────────────────────

// Browser-launch flags. Forwarded to launchHardenedChromium which appends
// its own defaults; duplicates get deduped.
const BROWSER_ARGS = [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--allow-file-access-from-files',
];

// Use the shared hardened launcher (lib/chromium-launch.ts). It searches
// /tmp/ms-playwright + /root/.cache/ms-playwright, lazily installs Chromium
// + system deps if missing, and caches the resolved binary path. This is the
// same launch path the brochure uses in production — slides now match.
async function launchBrowser(): Promise<Browser | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await launchHardenedChromium(BROWSER_ARGS);
    } catch (e: any) {
      console.warn(`[cw-slides-infographic] browser launch attempt ${attempt + 1} failed:`, e.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

function fileUri(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return `file:///${abs.replace(/^\/+/, '')}`;
}

async function screenshotOnce(browser: Browser, htmlPath: string, pngPath: string, waitMs: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: CANVAS_W, height: CANVAS_H } });
  try {
    page.setDefaultTimeout(30_000);
    await page.goto(fileUri(htmlPath), { waitUntil: 'domcontentloaded' });
    // Prefer to wait for actual SVG content (AntV) or the plain-HTML ready flag.
    try {
      await page.waitForFunction(
        'window.__HAS_SVG__ === true || (window.__RENDERED__ === true && document.querySelector("#container .card,#container .wrap"))',
        undefined,
        { timeout: waitMs },
      );
    } catch {
      // Fallback: wait for __RENDERED__ flag, then a brief settling delay
      try {
        await page.waitForFunction('window.__RENDERED__ === true', undefined, { timeout: 2000 });
      } catch {
        await page.waitForTimeout(waitMs);
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: pngPath, fullPage: true });
  } finally {
    await page.close().catch(() => {});
  }
}

async function htmlToPng(
  browser: Browser,
  htmlPath: string,
  pngPath: string,
  waitSchedule: ReadonlyArray<readonly [number, number]> = [[5000, 20_000], [8000, 25_000], [12_000, 30_000]],
): Promise<boolean> {
  const tryScreenshot = async (waitMs: number, overallTimeoutMs: number): Promise<boolean> => {
    try {
      await Promise.race([
        screenshotOnce(browser, htmlPath, pngPath, waitMs),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), overallTimeoutMs)),
      ]);
      return true;
    } catch (e: any) {
      console.warn(`[cw-slides-infographic] screenshot ${waitMs}ms failed for ${path.basename(htmlPath)}:`, e.message);
      return false;
    }
  };

  for (const [wait, total] of waitSchedule) {
    await tryScreenshot(wait, total);
    if (fs.existsSync(pngPath)) {
      const sz = fs.statSync(pngPath).size;
      if (sz >= MIN_PNG_BYTES) return true;
      console.warn(`[cw-slides-infographic] ${path.basename(pngPath)} blank (${sz}B < ${MIN_PNG_BYTES}), retrying...`);
    }
  }
  // After all retries, refuse blank PNGs — caller will escalate to next strategy.
  // Delete the tiny blank file so a later strategy can write a proper one.
  if (fs.existsSync(pngPath)) {
    const sz = fs.statSync(pngPath).size;
    if (sz < MIN_PNG_BYTES) {
      try { fs.unlinkSync(pngPath); } catch {}
      return false;
    }
    return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-topic generation (sequential, shared browser with restart cadence)
// ────────────────────────────────────────────────────────────────────────────

type RenderStrategy = 'antv' | 'antv-fallback' | 'plain';

async function renderInfographicOnce(
  browser: Browser,
  strategy: RenderStrategy,
  block: ContentBlock,
  template: string,
  topicTitle: string,
  slidePosition: number,
  outputDir: string,
): Promise<{ htmlPath: string; pngPath: string; ok: boolean; error?: string }> {
  const base = `infographic_${safeFilename(topicTitle)}_pos${slidePosition}_${strategy}`;
  const htmlPath = path.join(outputDir, `${base}.html`);
  const pngPath = path.join(outputDir, `${base}.png`);

  try {
    if (strategy === 'plain') {
      writePlainCardHtml(htmlPath, block, template);
      // Plain HTML has no AntV rendering — one fast attempt is usually enough.
      const ok = await htmlToPng(browser, htmlPath, pngPath, [[1000, 10_000], [2000, 15_000]]);
      return { htmlPath, pngPath, ok };
    }
    const optionsJson = buildAntvDsl(block, template);
    if (!optionsJson) return { htmlPath, pngPath, ok: false, error: 'Empty AntV options' };
    writeAntvHtml(htmlPath, optionsJson, `${topicTitle} — ${block.sub_title || ''}`);
    const ok = await htmlToPng(browser, htmlPath, pngPath);
    return { htmlPath, pngPath, ok };
  } catch (e: any) {
    return { htmlPath, pngPath, ok: false, error: e?.message || String(e) };
  }
}

async function generateSingleInfographic(
  block: ContentBlock,
  assignedTemplate: string,
  topicTitle: string,
  slidePosition: number,
  outputDir: string,
  getBrowser: () => Promise<Browser | null>,
): Promise<InfographicResult> {
  const subTitle = block.sub_title || `Slide ${slidePosition + 1}`;
  const vizType = block.visualization_type || 'overview';
  const caption = block.caption || '';
  const fallbackTpl = FALLBACK_TEMPLATES[slidePosition % FALLBACK_TEMPLATES.length];

  const strategies: Array<{ s: RenderStrategy; tpl: string }> = [
    { s: 'antv', tpl: assignedTemplate },
    { s: 'antv-fallback', tpl: fallbackTpl },
    { s: 'plain', tpl: assignedTemplate },
  ];

  let lastError = '';
  for (const { s, tpl } of strategies) {
    const browser = await getBrowser();
    if (!browser) {
      lastError = 'Browser unavailable';
      continue;
    }
    const { htmlPath, pngPath, ok, error } = await renderInfographicOnce(
      browser, s, block, tpl, topicTitle, slidePosition, outputDir,
    );
    if (ok && fs.existsSync(pngPath)) {
      if (s !== 'antv') {
        console.warn(`[cw-slides-infographic] '${subTitle}' rendered via ${s} (fallback)`);
      }
      return {
        topic: topicTitle,
        slide_position: slidePosition,
        sub_title: subTitle,
        visualization_type: vizType,
        template_used: `${tpl} (${s})`,
        html_path: htmlPath,
        image_path: pngPath,
        caption,
        generated: true,
      };
    }
    lastError = error || 'PNG conversion failed';
  }

  console.error(`[cw-slides-infographic] ALL strategies failed for '${subTitle}': ${lastError}`);
  return {
    topic: topicTitle,
    slide_position: slidePosition,
    sub_title: subTitle,
    visualization_type: vizType,
    template_used: assignedTemplate,
    image_path: null,
    caption,
    generated: false,
    error: lastError,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Entry — generate all infographics, returns map by topic title
// ────────────────────────────────────────────────────────────────────────────

// Strict topic-title matching. We only accept:
//   1) exact match
//   2) whitespace/underscore/dash-insensitive match (handles trivial typos)
// Substring matching was REMOVED — it caused topics whose titles share
// phrases (e.g. "Ethical principles in AI" vs "Apply ethical principles in
// decision-making") to return each other's content, so the same infographic
// showed up under the wrong topic.
function fuzzyGetContent(map: Record<string, InfographicContentEntry>, key: string): InfographicContentEntry | undefined {
  if (!map || !key) return undefined;
  if (map[key]) return map[key];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.,;:!?()"']/g, '');
  const nk = norm(key);
  if (!nk) return undefined;
  for (const k of Object.keys(map)) if (norm(k) === nk) return map[k];
  return undefined;
}

export async function generateAllInfographicsImpl(
  skeleton: InfographicSkeleton,
  contentMap: Record<string, InfographicContentEntry>,
  outputDir?: string,
): Promise<Record<string, InfographicResult[]>> {
  const dir = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cw_infographics_'));
  fs.mkdirSync(dir, { recursive: true });

  // Pre-fetch the common-icon cache before we start rendering. This is a
  // one-time cost per server lifetime (~1-2s for ~80 icons in parallel)
  // that pays back instantly — every subsequent infographic renders icons
  // from the inlined map without any network call from inside Playwright.
  // Fixes the "empty placeholder squares where icons should be" bug.
  await ensureIconCache();

  // Per-deck rotation counter for the back-fill path (see comment below).
  // Reset at the start of each deck so two consecutive generations don't
  // inherit the previous offset.
  const backfillUsed = new Map<string, number>();

  // Collect topic tasks; also back-fill assignments from content blocks
  // when the skeleton has none, same as the Python version.
  interface TopicTask {
    title: string;
    blocks: ContentBlock[];
    assignments: InfographicAssignment[];
    dir: string;
  }
  const topicTasks: TopicTask[] = [];

  for (const lo of skeleton.learning_outcomes ?? []) {
    for (const lu of lo.learning_units ?? []) {
      for (const topic of lu.topics ?? []) {
        const tTitle = topic.topic_title || 'Topic';
        let assignments = topic.infographic_assignments ?? [];
        const blocks = fuzzyGetContent(contentMap, tTitle)?.content_blocks ?? [];

        if (!assignments.length && blocks.length) {
          // Back-fill needed (skeleton produced no assignments for this
          // topic). Use the deck-wide round-robin counter `backfillUsed` so
          // templates rotate across topics instead of every topic restarting
          // from `list-grid-badge-card`. Fixes the "same template repeating
          // across topics" symptom that fell out of cascading exact-match
          // misses earlier in the pipeline.
          const used = new Set<string>();
          assignments = blocks.map((b, bi) => {
            const viz = b.visualization_type || 'overview';
            let suggested = b.suggested_template || '';
            if (!suggested || used.has(suggested)) {
              const candidates = TEMPLATE_MAP[viz] ?? TEMPLATE_MAP.overview;
              const available = candidates.filter((c) => !used.has(c));
              const pool = available.length ? available : candidates;
              const offset = backfillUsed.get(viz) ?? 0;
              suggested = pool[(offset + bi) % pool.length];
              backfillUsed.set(viz, (offset + 1) % candidates.length);
            }
            used.add(suggested);
            return {
              slide_position: bi,
              content_block_index: bi,
              sub_title: b.sub_title,
              visualization_type: viz,
              assigned_template: suggested,
            };
          });
          topic.infographic_assignments = assignments;
        }

        if (!assignments.length) continue;
        const topicDir = path.join(dir, safeFilename(tTitle));
        fs.mkdirSync(topicDir, { recursive: true });
        topicTasks.push({ title: tTitle, blocks, assignments, dir: topicDir });
      }
    }
  }

  const total = topicTasks.reduce((n, t) => n + t.assignments.length, 0);
  console.log(`[cw-slides-infographic] rendering ${total} infographics across ${topicTasks.length} topics`);

  const result: Record<string, InfographicResult[]> = {};

  let browser = await launchBrowser();
  if (!browser) {
    console.error('[cw-slides-infographic] failed to launch Chromium — all topics will fall back to text');
    for (const t of topicTasks) result[t.title] = [];
    return result;
  }

  // Shared browser state. getBrowser() returns a healthy browser, auto-
  // relaunches if dead, and recycles every MAX_PAGES_PER_BROWSER acquisitions
  // to preempt OOM.
  let rendersUsed = 0;
  const getBrowser = async (): Promise<Browser | null> => {
    if (browser && rendersUsed < MAX_PAGES_PER_BROWSER) {
      try {
        const p = await browser.newPage();
        await p.close();
        rendersUsed++;
        return browser;
      } catch {
        console.warn('[cw-slides-infographic] browser health check failed — relaunching');
      }
    }
    try { if (browser) await browser.close(); } catch {}
    browser = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const b = await launchBrowser();
      if (b) {
        browser = b;
        rendersUsed = 1;
        return browser;
      }
      console.warn(`[cw-slides-infographic] browser relaunch attempt ${attempt + 1}/5 failed`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  };

  try {
    for (let ti = 0; ti < topicTasks.length; ti++) {
      const task = topicTasks[ti];
      console.log(`[cw-slides-infographic] topic ${ti + 1}/${topicTasks.length}: '${task.title}' (${task.assignments.length} imgs)`);
      const topicOut: InfographicResult[] = [];

      for (let ai = 0; ai < task.assignments.length; ai++) {
        const a = task.assignments[ai];
        const blockIdx = a.content_block_index ?? 0;
        const slidePos = a.slide_position ?? 0;
        const tpl = a.assigned_template || 'list-grid-badge-card';

        const block: ContentBlock = task.blocks[blockIdx] ?? {
          sub_title: a.sub_title || `Slide ${slidePos + 1}`,
          visualization_type: a.visualization_type || 'overview',
          data: {
            title: a.sub_title || task.title,
            items: [{ label: task.title.slice(0, 15), desc: 'Key content', icon: 'mdi/information' }],
          },
        };

        const res = await generateSingleInfographic(block, tpl, task.title, slidePos, task.dir, getBrowser);
        topicOut.push(res);
      }

      const gen = topicOut.filter((r) => r.generated).length;
      console.log(`[cw-slides-infographic] '${task.title}': ${gen}/${topicOut.length} generated`);
      result[task.title] = topicOut;

      // Force a fresh browser between topics for a clean slate
      if (ti < topicTasks.length - 1) {
        try { if (browser) await browser.close(); } catch {}
        browser = null;
        rendersUsed = 0;
      }
    }
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }

  return result;
}
