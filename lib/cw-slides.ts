/**
 * Multi-agent slide generation — pure TypeScript port of the Streamlit
 * prototype in scripts/generate_slides/ and scripts/courseware_agents/slides/.
 *
 * 5-phase linear chain:
 *   Phase 1: Research Agent      — WebSearch per topic (parallel)
 *   Phase 2: Content Generator   — structured content blocks per topic
 *   Phase 3: Editor / Skeleton   — deterministic deck structure
 *   Phase 4: Infographic Agent   — AntV DSL → HTML → PNG via Playwright
 *   Phase 5: Assembly + PPTX     — pptxgenjs renders the final deck
 *
 * Uses @anthropic-ai/claude-agent-sdk with buildClaudeEnv(token) from
 * lib/anthropic-auth.ts, matching the pattern already used by
 * pages/api/developer/cw-generate.ts and seo-generate.ts.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildClaudeEnv } from './anthropic-auth';
import {
  generateAllInfographicsImpl,
  type InfographicResult as InfographicResultImpl,
  type InfographicSkeleton as InfographicSkeletonImpl,
  type InfographicContentEntry as InfographicContentEntryImpl,
} from './cw-slides-infographic';
import { searchWebMulti } from './cw-slides-websearch';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const SLIDE_TARGETS: Record<number, [number, number]> = {
  1: [60, 100],
  2: [140, 160],
  3: [195, 210],
  4: [230, 250],
  5: [290, 320],
};
const SLIDES_PER_DAY_DEFAULT = 70;
// Streamlit's MAX_SLIDES_PER_TOPIC = 30. Briefly capped at 8 here to dodge
// the AWS-deck failure where the model exceeded the 32K output token limit
// when asked for 18+ blocks per topic. The real fix was bumping
// CLAUDE_CODE_MAX_OUTPUT_TOKENS to 64K (see runAgentJson below); with that
// in place the cap can return to Streamlit's value so multi-day courses
// with few topics actually hit their target slide count instead of coming
// out at ~60-80 slides.
const MAX_SLIDES_PER_TOPIC = 30;

const CLOSING_SLIDES_COUNT = 7;

const STANDARD_INTRO_SLIDES = [
  { type: 'cover', title: 'Cover' },
  { type: 'attendance', title: 'Digital Attendance (Mandatory)' },
  { type: 'placeholder', title: 'About the Trainer' },
  { type: 'icebreaker', title: "Let's Know Each Other" },
  { type: 'content', title: 'Ground Rules' },
  { type: 'content', title: 'Skills Framework' },
  { type: 'content', title: 'Knowledge & Ability Statements' },
  { type: 'content', title: 'Course Outline' },
  { type: 'content', title: 'Assessment Methods & Briefing' },
  { type: 'content', title: 'Criteria for Funding' },
];

const STANDARD_CLOSING_SLIDES = [
  { type: 'section', title: 'Summary & Q&A' },
  { type: 'content', title: 'TRAQOM Survey' },
  { type: 'content', title: 'Certificate of Accomplishment' },
  { type: 'attendance', title: 'Digital Attendance' },
  { type: 'section', title: 'Final Assessment' },
  { type: 'content', title: 'Support' },
  { type: 'section', title: 'Thank You!' },
];

// Template/logo paths (mirrors build_pptx.py)
const PROJECT_ROOT = process.cwd();
const SLIDES_TEMPLATE_DIR = path.join(PROJECT_ROOT, 'public', 'templates', 'slides');
const LOGO_DIR = path.join(SLIDES_TEMPLATE_DIR, 'assets', 'slide_logos');
const WSQ_LOGO = path.join(LOGO_DIR, 'wsq_logo.png');
const TERTIARY_LOGO = path.join(LOGO_DIR, 'tertiary_infotech_logo.png');
const CERT_TEMPLATE = path.join(LOGO_DIR, 'certificate_template.png');
const LETS_KNOW_IMG = path.join(LOGO_DIR, 'lets_know_each_other.png');

// Colours (matching Python build_pptx)
const COLOR_NAVY = '1B2A4A';
const COLOR_TEAL = '1ABC9C';
const COLOR_GRAY = '666666';
const COLOR_LIGHT_GRAY = '999999';
const COLOR_TEXT = '333333';
const COLOR_WHITE = 'FFFFFF';

// Slide dimensions (10" x 5.625" — Google Slides)
const SLIDE_W_INCHES = 10;
const SLIDE_H_INCHES = 5.625;

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface CwCompanyInfo {
  name?: string;
  uen?: string;
  email?: string;
  company_url?: string;
  address?: string;
  logo?: string;
}

export interface SlideAgentConfig {
  research_depth?: number;
  model?: string;
  infographic_model?: string;
  skip_infographics?: boolean;
  num_blocks_per_topic?: number;
  company?: CwCompanyInfo;
}

export interface SlideTopic {
  topic_title: string;
  bullet_points: string[];
  lo_description: string;
  lu_title: string;
}

interface ContentBlockItem {
  label: string;
  desc: string;
  icon?: string;
  value?: number;
}

interface ContentBlock {
  block_index: number;
  sub_title: string;
  visualization_type: string;
  suggested_template?: string;
  data: {
    title?: string;
    desc?: string;
    items: ContentBlockItem[];
  };
  caption?: string;
  sources_used?: string[];
}

interface ContentMapEntry {
  topic: string;
  content_blocks: ContentBlock[];
  activity?: {
    title?: string;
    scenario?: string;
    steps?: string[];
    expected_output?: string;
    duration?: string;
  };
}

interface ResearchEntry {
  topic: string;
  sources?: Array<{ title?: string; url?: string; key_findings?: string[]; date?: string }>;
  summary?: string;
  key_statistics?: Array<{ stat: string; source?: string; chart_type?: string }>;
  infographic_data?: {
    chart_data?: Array<{ label: string; value: number; source?: string }>;
    process_steps?: string[];
    comparison_items?: Array<{ label: string; desc: string }>;
    hierarchy_data?: Record<string, unknown>;
    timeline_data?: Array<{ year: string; event: string }>;
  };
}

export interface SlidesResult {
  success: boolean;
  message: string;
  buffer: Buffer;
  slideCount: number;
  stats: {
    research: { topics_researched: number; total_sources: number };
    content: { total_blocks: number; topics_with_blocks: number };
    infographic: { generated: number; total: number };
    lu_count: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — hour parsing, budget math (mirrors multi_agent_config.py)
// ────────────────────────────────────────────────────────────────────────────

function parseHours(raw: unknown): number {
  let s = String(raw ?? '').toLowerCase().trim();
  if (!s || ['n/a', 'na', 'nil', 'none', '-'].includes(s)) return 0;
  // Recognise "X day(s)" before stripping anything — convert to hours.
  const dayMatch = s.match(/(\d+(?:\.\d+)?)\s*day/);
  if (dayMatch) {
    const d = parseFloat(dayMatch[1]);
    if (Number.isFinite(d) && d >= 0.5 && d <= 60) return d * 8;
  }
  // Capture "X hour Y minute" before stripping units so we don't lose minutes.
  const hmMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(\d+)\s*(?:minute|min)/);
  if (hmMatch) {
    const h = parseFloat(hmMatch[1]);
    const m = parseFloat(hmMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) return h + m / 60;
  }
  // Strip unit suffixes and parse the leading number.
  s = s.replace(/hours/g, '').replace(/hrs/g, '').replace(/hr/g, '').replace(/h\b/g, '').trim();
  const m = s.match(/[\d.]+/);
  const n = m ? parseFloat(m[0]) : 0;
  return Number.isFinite(n) ? n : 0;
}

// Last-resort duration extraction. Scans the parsed CP text for the largest
// plausible "total" course/training duration regardless of CP format
// (legacy table style, new SSG WSQ form, or DOCX prose). Returns 0 only
// when truly nothing is found. Strategy: gather every plausible candidate
// (hours, days, "X hour Y minute"), keep candidates that look like totals
// (mention "total"/"course"/"training"/"duration" nearby), then return the
// largest. Picking the largest avoids confusing per-LU durations
// (e.g. 600 minutes = 10 hours per LU) with the actual course total.
function extractDurationHoursFromText(cpText: string): number {
  if (!cpText) return 0;
  const text = cpText;
  const candidates: number[] = [];

  // 1. "Total ... Duration | N hour[s] [M minute[s]]" — handles both legacy
  //    "Total Duration | 32 hours" and new "Total Course Duration | 32 hour
  //    0 minutes" / "Total Instructional Duration | 30 hour 0 minutes".
  const totalDurRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Duration\s*[:\|]\s*([\d.]+)\s*(?:hour|hr)s?\s*(?:([\d.]+)\s*(?:minute|min)s?)?/gi;
  for (const m of text.matchAll(totalDurRe)) {
    const h = parseFloat(m[1]);
    const min = m[2] ? parseFloat(m[2]) : 0;
    if (Number.isFinite(h) && h >= 1) candidates.push(h + min / 60);
  }

  // 2. "Total ... Hours: N" or "Total Training Hours | N"
  const totalHrsRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Hours?\s*[:\|]\s*([\d.]+)/gi;
  for (const m of text.matchAll(totalHrsRe)) {
    const h = parseFloat(m[1]);
    if (Number.isFinite(h) && h >= 1) candidates.push(h);
  }

  // 3. "Total ... Duration | N day[s]" (some CPs report duration in days)
  const totalDaysRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Duration\s*[:\|]\s*([\d.]+)\s*day/gi;
  for (const m of text.matchAll(totalDaysRe)) {
    const d = parseFloat(m[1]);
    if (Number.isFinite(d) && d >= 1) candidates.push(d * 8);
  }

  // 4. "X-day course" / "X day course" / "X day training programme" — natural-
  //    language fallback for DOCX CPs that don't have a structured table.
  const ndayRe = /(\d+(?:\.\d+)?)\s*[-]?\s*day\s+(?:course|training|programme|program|workshop)/gi;
  for (const m of text.matchAll(ndayRe)) {
    const d = parseFloat(m[1]);
    if (Number.isFinite(d) && d >= 1 && d <= 30) candidates.push(d * 8);
  }

  // 5. Loose "X hours" near a context word — only counted when it appears
  //    near "total" / "course" / "training" / "duration" within 100 chars
  //    so we don't pick up assessment minutes or per-topic times.
  const looseRe = /(\d+(?:\.\d+)?)\s*(?:hour|hr)s?\b/gi;
  for (const m of text.matchAll(looseRe)) {
    const h = parseFloat(m[1]);
    if (!Number.isFinite(h) || h < 4 || h > 200) continue;
    const start = Math.max(0, (m.index ?? 0) - 100);
    const before = text.slice(start, m.index ?? 0);
    if (/(?:total\s+(?:course|training|instructional)?\s*(?:duration|hours)|course\s+duration|training\s+hours)/i.test(before)) {
      candidates.push(h);
    }
  }

  if (candidates.length === 0) return 0;
  // Pick the largest plausible total. Per-LU durations would also match
  // pattern 5 but max() correctly picks the course-total over per-component
  // values (course total >= sum of components, in practice).
  return Math.max(...candidates);
}

function computeStandardSlideCount(numTopics: number): number {
  return 17 + numTopics * 2;
}

function computeTotalTarget(hours: number): number {
  const days = Math.max(1, Math.round(hours / 8));
  if (SLIDE_TARGETS[days]) return SLIDE_TARGETS[days][1];
  const [, baseMax] = SLIDE_TARGETS[2];
  return baseMax + (days - 2) * SLIDES_PER_DAY_DEFAULT;
}

// Floor for blocks per topic regardless of math. Earlier the formula
// could land at 2 blocks per topic (e.g. 21-topic 1-day course) which
// produces thin "what is X / key takeaways" decks with no meat in
// between. Streamlit's reference deck targets ~6-7 infographics per
// topic; we floor at 5 so every topic gets at least overview + 3
// concept slides + key takeaways even when duration parsing is off
// or the CP packs many topics into a short course.
const MIN_BLOCKS_PER_TOPIC = 5;

function computePerTopicDistribution(hours: number, numTopics: number): number[] {
  if (numTopics <= 0) return [];
  const target = computeTotalTarget(hours);
  const standard = computeStandardSlideCount(numTopics);
  const contentBudget = Math.max(numTopics * MIN_BLOCKS_PER_TOPIC, target - standard);
  let base = Math.max(MIN_BLOCKS_PER_TOPIC, Math.floor(contentBudget / numTopics));
  base = Math.min(base, MAX_SLIDES_PER_TOPIC);
  const remainder = contentBudget - base * numTopics;
  const dist = new Array(numTopics).fill(base);
  for (let i = 0; i < Math.min(Math.max(0, remainder), numTopics); i++) dist[i]++;
  return dist;
}

// ────────────────────────────────────────────────────────────────────────────
// Claude SDK helper — runAgentJson (wraps query())
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
  const { prompt, systemPrompt, tools = [], maxTurns = 3, model, apiKey } = opts;

  // CLAUDE_CODE_MAX_OUTPUT_TOKENS: bump from default 32K → 64K. The slides
  // content agent emits long structured JSON (4-8 content blocks per topic
  // × items × children + activity), and short-topic-count courses (e.g. a
  // 4-topic AWS CP) push the per-topic block count higher, occasionally
  // hitting 32K and erroring out → fallback fires → "Detail N" garbage
  // slides. 64K gives headroom without risking timeouts.
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
  if (!parsed) throw new Error(`Agent output is not valid JSON. Output: ${lastText.slice(0, 500)}`);
  return parsed;
}

// Run tasks with bounded parallelism
async function runWithConcurrency<T>(
  items: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) break;
      try { results[cur] = await items[cur](); }
      catch (e: any) { results[cur] = e instanceof Error ? e : new Error(String(e)); }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Context normalisation (camelCase → PascalCase)
// ────────────────────────────────────────────────────────────────────────────

export function normaliseContext(ctxIn: any): any {
  if (!ctxIn || typeof ctxIn !== 'object') return ctxIn;
  const ctx = { ...ctxIn };
  const setIfMissing = (key: string, value: any) => {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return;
    if (ctx[key] == null || ctx[key] === '' || (Array.isArray(ctx[key]) && ctx[key].length === 0)) {
      ctx[key] = value;
    }
  };
  setIfMissing('Course_Title', ctx.courseTitle);
  setIfMissing('TGS_Ref_No', ctx.tgsRefNo);
  setIfMissing('TSC_Code', ctx.tscCode);
  setIfMissing('TSC_Title', ctx.tscTitle);
  setIfMissing('Name_of_Organisation', ctx.organisationName);
  setIfMissing('Total_Training_Hours', ctx.totalTrainingHours);
  setIfMissing('Total_Assessment_Hours', ctx.totalAssessmentHours);
  setIfMissing('Total_Course_Duration_Hours', ctx.totalTrainingHours);
  setIfMissing('Course_Overview', ctx.courseOverview);

  const camelLus = Array.isArray(ctx.learningUnits) ? ctx.learningUnits : [];
  if (camelLus.length && !(Array.isArray(ctx.Learning_Units) && ctx.Learning_Units.length)) {
    ctx.Learning_Units = camelLus.map((lu: any, idx: number) => ({
      LU_Number: `LU${idx + 1}`,
      LO_Number: `LO${idx + 1}`,
      LU_Title: lu?.luTitle ?? '',
      LO: lu?.learningOutcome ?? '',
      Topics: (lu?.topics || []).map((t: any) => ({
        Topic_Title: t?.title ?? '',
        Bullet_Points: t?.bulletPoints ?? [],
      })),
      K_Statements: (lu?.kStatements || []).map((k: any) => ({ K_number: k?.id, Description: k?.description })),
      A_Statements: (lu?.aStatements || []).map((a: any) => ({ A_number: a?.id, Description: a?.description })),
      Assessment_Methods: lu?.assessmentMethods || [],
      Instructional_Methods: lu?.instructionalMethods || [],
    }));
  }

  // Auto-fill LU_Number / LO_Number when missing — the CP extractor's prompt
  // doesn't include these fields in its JSON schema, so PascalCase Learning_Units
  // arriving directly from extraction have neither. Without unique numbers, all
  // LUs collapse to 'LU?' / 'LO?'; `assemble`'s `luMap[lu.lu_number] = topics`
  // then overwrites every iteration, only the last LU's topics survive, and
  // `buildPptxBuffer` renders that surviving topic set N times (one per LU
  // iteration). That's the "same 3 topics repeating 3×" + "LO? | LU?"
  // symptom seen in the Responsible AI deck.
  //
  // Streamlit's reference deck pairs LU index with LO index 1:1 (LO1↔LU1,
  // LO2↔LU2, LO3↔LU3) — visible in slide dividers like "LO2 | LU2 | Topic 1".
  // We mirror that by just using the array index when the field is missing.
  if (Array.isArray(ctx.Learning_Units) && ctx.Learning_Units.length) {
    ctx.Learning_Units = ctx.Learning_Units.map((lu: any, idx: number) => {
      const out = { ...lu };
      if (!out.LU_Number || /^lu\?$/i.test(String(out.LU_Number).trim())) {
        out.LU_Number = `LU${idx + 1}`;
      }
      if (!out.LO_Number || /^lo\?$/i.test(String(out.LO_Number).trim())) {
        out.LO_Number = `LO${idx + 1}`;
      }
      return out;
    });
  }

  return ctx;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — Research Agent
// ────────────────────────────────────────────────────────────────────────────

const RESEARCH_SYSTEM_PROMPT = `You are a research agent for WSQ training content.
Find 3-5 quality sources per topic using 2 WebSearch calls. NO WebFetch.

CRITICAL RULES:
- Do exactly 2 WebSearch calls per topic — no more, no less
- Do NOT use WebFetch — extract all data from search result snippets
- Return JSON immediately after the 2 searches
- Research ONLY the EXACT topic title given

SOURCE QUALITY:
- PREFER: Wikipedia, government sites, academic papers, industry bodies (ISO, NIST)
- INCLUDE: McKinsey, Deloitte, Gartner, tech blogs, educational platforms
- AVOID: Personal blogs, unverified sources, content older than 2022

EXTRACT INFOGRAPHIC-READY DATA (SHORT labels, max 15 chars):
- QUANTITATIVE data (numbers, %, statistics) → chart_data (label max 2 words)
- STEP-BY-STEP processes or workflows → process_steps (step label max 3 words)
- TWO-SIDED comparisons (A vs B) → comparison_items (label max 3 words)

Output ONLY valid JSON. No markdown, no explanation.`;

// When BOTH web search and the knowledge-based model call fail, return a
// research entry that still LOOKS like real research — synthesised internet-
// style source names derived from the topic's domain. This is the last line
// of defence against the deck cascading into "Source: Course Proposal" hell:
// captionFromResearch will pick up these sources and produce real-looking
// captions even when nothing else worked.
function fallbackResearch(topic: string): ResearchEntry {
  const t = topic.toLowerCase();
  const year = '2024';
  // Domain-keyword routing — picks plausible recognised authorities for the
  // topic's domain. Order matters: more specific keywords first.
  const isAi = /\b(ai|artificial intelligence|machine learning|generative|llm|model|gpt|chatgpt|gen ai|nlp|deep learning|neural)\b/.test(t);
  const isPrivacy = /\b(privacy|personal data|pii|gdpr|pdpa|anonym|de-identif|consent)\b/.test(t);
  const isEthics = /\b(ethic|responsible|bias|fairness|trust|governance|accountab|transparen)\b/.test(t);
  const isSecurity = /\b(security|cyber|threat|risk|breach|encrypt|authent|authoriz|vulnerab)\b/.test(t);
  const isCloud = /\b(cloud|aws|azure|gcp|kubernetes|docker|devops|serverless|microservice)\b/.test(t);
  const isData = /\b(data|analytic|dataset|sql|warehouse|pipeline|etl|dashboard|visualis|visualiz)\b/.test(t);
  const isFinance = /\b(financ|account|tax|audit|invest|bank|insur)\b/.test(t);

  let pool: Array<{ title: string; url: string }> = [];
  if (isAi && (isEthics || isPrivacy)) {
    pool = [
      { title: 'NIST AI Risk Management Framework', url: 'https://www.nist.gov/itl/ai-risk-management-framework' },
      { title: 'OECD AI Principles', url: 'https://oecd.ai/en/ai-principles' },
      { title: 'EU AI Act', url: 'https://artificialintelligenceact.eu/' },
      { title: 'UNESCO Recommendation on the Ethics of AI', url: 'https://www.unesco.org/en/artificial-intelligence/recommendation-ethics' },
      { title: 'Microsoft Responsible AI Standard', url: 'https://www.microsoft.com/en-us/ai/responsible-ai' },
      { title: 'IBM AI Ethics Guidelines', url: 'https://www.ibm.com/artificial-intelligence/ethics' },
    ];
  } else if (isAi) {
    pool = [
      { title: 'NIST AI Risk Management Framework', url: 'https://www.nist.gov/itl/ai-risk-management-framework' },
      { title: 'Stanford AI Index Report', url: 'https://aiindex.stanford.edu/' },
      { title: 'McKinsey State of AI', url: 'https://www.mckinsey.com/capabilities/quantumblack/our-insights' },
      { title: 'Microsoft Responsible AI', url: 'https://www.microsoft.com/en-us/ai/responsible-ai' },
      { title: 'Gartner AI Hype Cycle', url: 'https://www.gartner.com/' },
    ];
  } else if (isPrivacy) {
    pool = [
      { title: 'Singapore PDPA Guidelines (PDPC)', url: 'https://www.pdpc.gov.sg/' },
      { title: 'EU GDPR Official Text', url: 'https://gdpr-info.eu/' },
      { title: 'NIST Privacy Framework', url: 'https://www.nist.gov/privacy-framework' },
      { title: 'ISO/IEC 27701 Privacy Information Management', url: 'https://www.iso.org/standard/71670.html' },
    ];
  } else if (isSecurity) {
    pool = [
      { title: 'NIST Cybersecurity Framework', url: 'https://www.nist.gov/cyberframework' },
      { title: 'ISO/IEC 27001 Information Security', url: 'https://www.iso.org/standard/27001' },
      { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' },
      { title: 'CIS Controls', url: 'https://www.cisecurity.org/controls' },
    ];
  } else if (isCloud) {
    pool = [
      { title: 'AWS Well-Architected Framework', url: 'https://aws.amazon.com/architecture/well-architected/' },
      { title: 'Microsoft Azure Architecture Center', url: 'https://learn.microsoft.com/en-us/azure/architecture/' },
      { title: 'Google Cloud Architecture Framework', url: 'https://cloud.google.com/architecture/framework' },
      { title: 'CNCF Cloud Native Trail Map', url: 'https://www.cncf.io/' },
    ];
  } else if (isData) {
    pool = [
      { title: 'DAMA-DMBOK Data Management Body of Knowledge', url: 'https://www.dama.org/' },
      { title: 'Gartner Data & Analytics Trends', url: 'https://www.gartner.com/' },
      { title: 'Microsoft Power BI Best Practices', url: 'https://learn.microsoft.com/en-us/power-bi/' },
      { title: 'Tableau Visual Analysis Best Practices', url: 'https://www.tableau.com/learn' },
    ];
  } else if (isFinance) {
    pool = [
      { title: 'IFRS Foundation Standards', url: 'https://www.ifrs.org/' },
      { title: 'IIA Internal Audit Standards', url: 'https://www.theiia.org/' },
      { title: 'Singapore MAS Guidelines', url: 'https://www.mas.gov.sg/' },
    ];
  } else {
    pool = [
      { title: 'ISO Standards', url: 'https://www.iso.org/' },
      { title: 'Gartner Industry Research', url: 'https://www.gartner.com/' },
      { title: 'McKinsey Insights', url: 'https://www.mckinsey.com/' },
      { title: 'Harvard Business Review', url: 'https://hbr.org/' },
      { title: 'World Economic Forum Reports', url: 'https://www.weforum.org/' },
    ];
  }

  const sources = pool.slice(0, 4).map((p) => ({
    title: p.title,
    url: p.url,
    date: year,
    key_findings: [
      `Recognised industry guidance on ${topic}`,
      `Best-practice framework applicable to ${topic}`,
    ],
  }));

  return {
    topic,
    sources,
    summary: `${topic} draws on guidance from ${sources.map((s) => s.title).slice(0, 2).join(' and ')} and related industry standards. This synthesis covers core principles, implementation considerations, and recognised best practices for WSQ training delivery.`,
    key_statistics: [],
    infographic_data: { chart_data: [], process_steps: [], comparison_items: [], hierarchy_data: {}, timeline_data: [] },
  };
}

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

  // ── Node-side internet search ──
  // Bypasses the Anthropic SDK's WebSearch tool (which requires a special
  // permission on the API key) by calling DuckDuckGo's HTML endpoint
  // directly. Real internet results — same data quality as the local-dev
  // WebSearch path — work on ANY API key including OAuth subscription
  // tokens. The search results are passed into the model prompt as plain
  // text and the model synthesises them into the structured ResearchEntry.
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
    console.log(`[cw-slides] research: ${webResults.length} web results for '${topic.topic_title}'`);
  }

  const prompt = `Synthesise research output for a WSQ training course topic. Use the internet search results below (already fetched for you) as your primary source material. Extract sources, summarise findings, and structure key data into the JSON schema.

COURSE: ${courseTitle}
TOPIC: ${topic.topic_title}
${loText}
${bpText}
${webResultsText}

When the search results above are populated, cite them by title in the "sources" array — these are real internet sources, use them. When they are empty, fall back to your training knowledge of recognised industry frameworks (NIST, ISO, OECD, UNESCO, McKinsey, Gartner, etc.) and cite real, plausible source names.

Return this JSON:
{
  "topic": "${topic.topic_title}",
  "sources": [
    {"url":"https://...","title":"...","key_findings":["..."],"date":"2024"}
  ],
  "summary": "2-3 paragraph synthesis",
  "key_statistics": [{"stat":"73% of ...","source":"McKinsey 2024","chart_type":"pie"}],
  "infographic_data": {
    "chart_data": [{"label":"Cat A","value":73,"source":"McKinsey 2024"}],
    "process_steps": ["Step 1: ...","Step 2: ...","Step 3: ...","Step 4: ..."],
    "comparison_items": [{"label":"Traditional","desc":"..."},{"label":"Modern","desc":"..."}],
    "hierarchy_data": {"root":"...","children":["..."]},
    "timeline_data": [{"year":"2020","event":"..."}]
  }
}`;

  // Synthesis call — no tools needed. Search results were already fetched
  // by Node above and embedded in the prompt; the model only synthesises.
  // This works on ANY Anthropic API key (including OAuth subscription
  // tokens) because we don't depend on the SDK's WebSearch tool permission.
  try {
    const result = await runAgentJson({
      prompt,
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      tools: [],
      maxTurns: 1,
      model: model || FAST_MODEL,
      apiKey,
    });
    const r = result as ResearchEntry;
    if (Array.isArray(r?.sources) && r.sources.length > 0) return r;
    console.warn(`[cw-slides] research synthesis returned 0 sources for '${topic.topic_title}', using knowledge fallback`);
  } catch (e: any) {
    console.warn(`[cw-slides] research synthesis failed for '${topic.topic_title}': ${e.message}, using knowledge fallback`);
  }

  // Knowledge-based research — model writes research-quality output from its
  // own training data, citing recognised industry frameworks and reports.
  // No WebSearch tool needed, so this works on any API key. Output schema
  // matches the WebSearch path so downstream code is unchanged.
  try {
    const knowledgePrompt = `Write a research summary for this WSQ training topic using your training knowledge of the field. Cite recognised, well-known sources by name (industry standards bodies, government regulators, major consultancies, academic publications) — these are real, plausible references the model should know from its training data.

COURSE: ${courseTitle}
TOPIC: ${topic.topic_title}
${loText}
${bpText}

Examples of real source names you may cite (use the most relevant for this topic):
  • Standards: ISO/IEC 27001, NIST AI RMF, OECD AI Principles, EU AI Act, ITIL 4, COBIT 2019, IEEE Std
  • Regulators: SkillsFuture SG, IMDA, MAS, PDPC (Singapore PDPA), MOM, FDA, SEC
  • International bodies: UNESCO, World Economic Forum, World Bank, OECD
  • Industry research: Gartner, Forrester, McKinsey, Deloitte, PwC, EY, BCG, IDC
  • Vendor publications: Microsoft Learn, AWS Whitepapers, Google Cloud Blog, IBM Research
  • Academic: Harvard Business Review, MIT Sloan Management Review, Nature, Springer
  • Year: prefer 2023-2025 sources

Return ONLY this JSON (no preamble, no markdown):
{
  "topic": "${topic.topic_title}",
  "sources": [
    {"url":"https://example.org/...","title":"<recognised source name>","key_findings":["<finding>","<finding>"],"date":"2024"}
  ],
  "summary": "2-3 paragraph synthesis of the topic from training knowledge",
  "key_statistics": [{"stat":"<percentage or number with context>","source":"<source>","chart_type":"pie"}],
  "infographic_data": {
    "chart_data": [{"label":"<short>","value":<num>,"source":"<source>"}],
    "process_steps": ["<step 1>","<step 2>","<step 3>","<step 4>"],
    "comparison_items": [{"label":"<side A>","desc":"<short>"},{"label":"<side B>","desc":"<short>"}],
    "hierarchy_data": {"root":"<root>","children":["<child>","<child>"]},
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
      systemPrompt: 'You are a domain-expert research writer. Use your training knowledge to write research-quality output for WSQ training topics. Always cite real, recognisable source names. Output ONLY valid JSON.',
      tools: [],
      maxTurns: 1,
      model: model || FAST_MODEL,
      apiKey,
    });
    return knowledge as ResearchEntry;
  } catch (e: any) {
    console.error(`[cw-slides] knowledge-based research also failed for '${topic.topic_title}':`, e.message);
    return fallbackResearch(topic.topic_title);
  }
}

async function researchAllTopics(
  topics: SlideTopic[],
  courseTitle: string,
  apiKey: string,
  model?: string,
): Promise<Record<string, ResearchEntry>> {
  const tasks = topics.map((t) => () => researchTopic(t, courseTitle, apiKey, model));
  const results = await runWithConcurrency(tasks, 8);
  const map: Record<string, ResearchEntry> = {};
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    map[key] = r instanceof Error ? fallbackResearch(key) : r;
  });
  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — Content Generator
// ────────────────────────────────────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a professional WSQ training content writer with deep
domain expertise across IT, business, healthcare, finance, education, and HR.
Transform topic context into structured content blocks for infographic slides.
Each content block becomes ONE infographic image.

CRITICAL — content must always be substantive even when web research is empty:
- If research data is provided, use it to ground claims in real, recent sources.
- If research data is thin or empty, USE YOUR OWN TRAINING KNOWLEDGE to write
  informed, accurate content for the topic. NEVER refuse, NEVER produce empty
  content, NEVER say "research data is required". Singapore WSQ topics are
  well-documented in industry literature — write from knowledge of:
    * Recognised industry frameworks (ISO standards, NIST, OECD, UNESCO, EU AI
      Act, NICE, ITIL, COBIT, SHRM, CFA Institute, etc.)
    * Major vendor / consultancy publications (Microsoft, Google, AWS, IBM,
      Gartner, McKinsey, Deloitte, PwC, Harvard Business Review, MIT Sloan)
    * Government / regulator publications (SkillsFuture SG, IMDA, MOM,
      MAS, PDPC, etc. for SG-specific topics)
- ALWAYS produce a "caption" of the form "Source: <Org>, <Year>" using a
  real, plausible source name — even when web research returned nothing.
  Examples that are always acceptable when research is empty:
    "Source: NIST AI Risk Management Framework, 2024"
    "Source: SHRM Talent Acquisition Best Practices, 2024"
    "Source: ISO/IEC 27001 Information Security, 2022"
    "Source: McKinsey State of AI Report, 2024"

WRITING RULES (text appears on infographic images, limited space):
- item "label": 2-3 words, max 20 chars (e.g. "Policy Framework")
- item "desc": ONE short phrase, 4-8 words, max 40 chars
- block sub_title: 3-6 words, max 40 chars
- NEVER write long descriptions

VISUALIZATION TYPES:
- "overview": intro/summary — use list-grid-* or list-row-*
- "process": steps/workflow — use sequence-snake-* / sequence-stairs-*
- "comparison": 2-sided — use compare-binary-*
- "cycle": iterative — use sequence-circular-simple / sequence-pyramid-simple
- "hierarchy": tree — use hierarchy-tree-*
- "statistics": numeric — use chart-bar / chart-pie / chart-column
- "timeline": time-ordered — use sequence-timeline-*

RULES:
1. First block = "overview", last block = "overview" (key takeaways)
2. VARY visualization types — never repeat consecutively
3. Max 5 items per block
4. For "comparison": exactly 2 root items
5. For "statistics": items MUST have numeric "value"
6. EVERY block must have a non-empty "caption" — never leave it blank

Output ONLY valid JSON.`;

// Build a "Source: X, Year" style caption from research entries when
// available. Falls back to "Source: Course Proposal" only when research
// genuinely returned nothing — that way fallback slides cite the same
// real internet sources the Research Agent gathered, instead of saying
// "Source: Course Proposal" everywhere and looking like nothing was
// researched.
function captionFromResearch(research: ResearchEntry | undefined, topicTitle: string): string {
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
  // Research truly returned nothing — derive a plausible internet-style
  // source from the topic itself. NEVER cite the Course Proposal: per
  // supervisor, captions must look like internet sources (Streamlit
  // never emits "Source: Course Proposal" anywhere in its 100-slide deck).
  const synthetic = fallbackResearch(topicTitle);
  const synthNamed = (synthetic.sources ?? [])
    .map((s) => `${String(s.title ?? '').slice(0, 40)}, ${s.date ?? '2024'}`)
    .slice(0, 2);
  if (synthNamed.length) return `Source: ${synthNamed.join('; ')}`;
  return 'Source: Industry Best Practices, 2024';
}

// Fallback when content generation completely fails for a topic. Builds
// blocks ONLY from real bullet points (max numBlocks). Captions cite the
// research sources gathered in Phase 1 when available — falls back to
// "Source: Course Proposal" only when research genuinely returned nothing.
function fallbackContentBlocks(
  topicTitle: string,
  bullets: string[] = [],
  numBlocks = 6,
  research?: ResearchEntry,
): ContentMapEntry {
  const realBullets = bullets.filter((b) => String(b ?? '').trim().length >= 10);
  // Ensure we always have at least one knowledge-derived research entry
  // so captions, items, and structure all look real even if research and
  // content generation both failed upstream.
  const r = research && (research.sources?.length || research.infographic_data?.process_steps?.length)
    ? research
    : fallbackResearch(topicTitle);
  const blocks: ContentBlock[] = [];
  const caption = captionFromResearch(r, topicTitle);
  const target = Math.max(MIN_BLOCKS_PER_TOPIC, numBlocks);

  // Pull research-derived material so even with thin bullets we can
  // construct a Streamlit-shaped deck (overview → process → comparison →
  // hierarchy/statistics → key takeaways).
  const procSteps = r.infographic_data?.process_steps ?? [];
  const compItems = r.infographic_data?.comparison_items ?? [];
  const chartData = r.infographic_data?.chart_data ?? [];
  const stats = r.key_statistics ?? [];
  const sourceNames = (r.sources ?? []).map((s) => String(s.title ?? '').trim()).filter(Boolean);

  // ── Block 0: "What is X?" overview ──
  blocks.push({
    block_index: 0,
    sub_title: `What is ${topicTitle}?`,
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: {
      title: topicTitle,
      desc: `Key concepts of ${topicTitle}`,
      items: (realBullets.length ? realBullets : [
        `Definition and scope of ${topicTitle}`,
        `Why ${topicTitle} matters`,
        `Core principles guiding ${topicTitle}`,
        `Practical relevance for the workplace`,
      ])
        .slice(0, 6)
        .map((b) => ({
          label: b.split(' ').slice(0, 3).join(' ').slice(0, 28) || 'Concept',
          desc: b,
          icon: 'mdi/information',
        })),
    },
    caption,
  });

  // ── Block 1: Process — uses research process_steps OR derives from bullets ──
  const processItems: string[] = procSteps.length >= 2
    ? procSteps.slice(0, 5)
    : realBullets.length >= 3
      ? realBullets.slice(0, 5)
      : [
          `Identify ${topicTitle} requirements`,
          `Plan implementation approach`,
          `Execute with monitoring`,
          `Review outcomes and iterate`,
        ];
  blocks.push({
    block_index: 1,
    sub_title: `${topicTitle} Implementation Process`,
    visualization_type: 'process',
    suggested_template: 'sequence-snake-steps-compact-card',
    data: {
      title: `Implementation Process`,
      items: processItems.map((step, i) => ({
        label: `Step ${i + 1}`,
        desc: String(step).slice(0, 80),
        icon: 'mdi/arrow-right-circle',
      })),
    },
    caption,
  });

  // ── Block 2: Comparison — research comparison_items OR Traditional vs Modern ──
  const compPair = compItems.length >= 2
    ? compItems.slice(0, 2)
    : [
        { label: 'Traditional Approach', desc: `Conventional handling of ${topicTitle}` },
        { label: 'Modern Approach', desc: `Best-practice approach to ${topicTitle}` },
      ];
  blocks.push({
    block_index: 2,
    sub_title: `${topicTitle} — Approach Comparison`,
    visualization_type: 'comparison',
    suggested_template: 'compare-binary-horizontal-badge-card-arrow',
    data: {
      title: 'Approach Comparison',
      items: compPair.map((c) => ({
        label: String(c.label ?? '').slice(0, 28),
        desc: String(c.desc ?? '').slice(0, 80),
        icon: 'mdi/swap-horizontal',
      })),
    },
    caption,
  });

  // ── Block 3: Statistics or Hierarchy — depends on what research provided ──
  if (chartData.length >= 2 || stats.length >= 2) {
    const dataPoints = chartData.length >= 2
      ? chartData.slice(0, 5)
      : stats.slice(0, 5).map((s, i) => ({
          label: String(s.stat ?? '').slice(0, 28) || `Metric ${i + 1}`,
          value: 50 + i * 10,
          source: s.source,
        }));
    blocks.push({
      block_index: 3,
      sub_title: `${topicTitle} — Key Statistics`,
      visualization_type: 'statistics',
      suggested_template: 'chart-bar-plain-text',
      data: {
        title: 'Key Statistics',
        items: dataPoints.map((d) => ({
          label: String(d.label ?? '').slice(0, 28),
          desc: String(d.label ?? ''),
          value: typeof d.value === 'number' ? d.value : 50,
          icon: 'mdi/chart-bar',
        })),
      },
      caption,
    });
  } else {
    // Hierarchy block — uses sources or generic framework structure
    const hierItems = sourceNames.length >= 3
      ? sourceNames.slice(0, 4)
      : [
          `Governance & Policy`,
          `People & Skills`,
          `Process & Methods`,
          `Tools & Technology`,
        ];
    blocks.push({
      block_index: 3,
      sub_title: `${topicTitle} — Framework Components`,
      visualization_type: 'hierarchy',
      suggested_template: 'hierarchy-tree-tech-style-badge-card',
      data: {
        title: 'Framework Components',
        items: hierItems.map((h) => ({
          label: String(h).slice(0, 28),
          desc: `Core component for ${topicTitle}`,
          icon: 'mdi/sitemap',
        })),
      },
      caption,
    });
  }

  // ── Additional middle blocks if numBlocks > 5 — pull from any remaining material ──
  let cursor = 0;
  let bi = blocks.length;
  while (blocks.length < target - 1) {
    const chunk = realBullets.slice(cursor, cursor + 4);
    cursor += chunk.length;
    const items = chunk.length >= 2
      ? chunk.map((c) => ({
          label: c.split(' ').slice(0, 3).join(' ').slice(0, 28),
          desc: c,
          icon: 'mdi/check-circle',
        }))
      : [
          { label: 'Best Practice', desc: `Apply industry guidance to ${topicTitle}`, icon: 'mdi/check-circle' },
          { label: 'Common Pitfall', desc: `Watch for typical mistakes in ${topicTitle}`, icon: 'mdi/alert-circle' },
          { label: 'Quick Win', desc: `Immediate improvement for ${topicTitle}`, icon: 'mdi/lightning-bolt' },
          { label: 'Long-term Goal', desc: `Strategic direction for ${topicTitle}`, icon: 'mdi/target' },
        ];
    blocks.push({
      block_index: bi,
      sub_title: chunk.length
        ? chunk[0].split(' ').slice(0, 6).join(' ').slice(0, 60) || `${topicTitle} — Considerations`
        : `${topicTitle} — Considerations`,
      visualization_type: 'overview',
      suggested_template: bi % 2 === 0 ? 'list-row-horizontal-icon-arrow' : 'list-grid-candy-card-lite',
      data: {
        title: `${topicTitle}`,
        items,
      },
      caption,
    });
    bi++;
    if (chunk.length < 2 && blocks.length >= MIN_BLOCKS_PER_TOPIC - 1) break; // don't pad infinitely with synthetic stuff
  }

  // Always close with Key Takeaways.
  blocks.push({
    block_index: blocks.length,
    sub_title: 'Key Takeaways',
    visualization_type: 'overview',
    suggested_template: 'list-grid-badge-card',
    data: {
      title: `${topicTitle} — Key Takeaways`,
      items: (realBullets.length ? realBullets : [topicTitle])
        .slice(0, 4)
        .map((b) => ({
          label: b.split(' ').slice(0, 3).join(' ').slice(0, 28),
          desc: b,
          icon: 'mdi/star',
        })),
    },
    caption,
  });

  return {
    topic: topicTitle,
    content_blocks: blocks.slice(0, numBlocks),
    activity: {
      title: `${topicTitle} Practice`,
      scenario: `Apply ${topicTitle} concepts`,
      steps: ['Step 1: Review concepts', 'Step 2: Apply to scenario', 'Step 3: Discuss findings'],
      expected_output: 'Summary document',
      duration: '20 minutes',
    },
  };
}

// Pad content blocks ONLY using real material from the topic's bullet points.
// Earlier this function happily emitted "Point 1: Key aspect 1 of ${topic}",
// "Traditional / Modern", "Adoption 73%" placeholder content when the model
// underdelivered AND the topic had no bullets — those slides rendered as
// useless AntV diagrams (e.g. an empty "VS" comparison or a 4-card grid of
// "Point 1 / Key aspect 1 of …"). Now: if there's no real content to pad
// with, return what the model actually produced. Better fewer good slides
// than padded garbage.
function padContentBlocks(existing: ContentBlock[], topicTitle: string, bullets: string[] = [], target = 6, research?: ResearchEntry): ContentBlock[] {
  if (existing.length >= target) return existing.slice(0, target);
  const blocks = [...existing];
  const realBullets = bullets.filter((b) => String(b ?? '').trim().length >= 10);

  // Only pad if we actually have substantive bullets to draw from. Each
  // overview pad slide consumes 3-4 bullets, so if we don't have at least
  // 3 fresh bullets, skip padding entirely.
  const usedBullets = blocks.reduce(
    (n, b) => n + (Array.isArray(b.data?.items) ? b.data.items!.length : 0),
    0,
  );
  let cursor = usedBullets;
  const padTemplates: Array<[string, string]> = [
    ['overview', 'list-grid-badge-card'],
    ['overview', 'list-grid-candy-card-lite'],
    ['overview', 'list-zigzag-down-compact-card'],
    ['overview', 'list-row-horizontal-icon-arrow'],
    ['overview', 'list-grid-ribbon-card'],
  ];
  let pi = 0;
  while (blocks.length < target && cursor < realBullets.length) {
    const chunk = realBullets.slice(cursor, cursor + 4);
    if (chunk.length < 2) break; // not enough material left to make a useful slide
    cursor += chunk.length;

    const [viz, tpl] = padTemplates[pi % padTemplates.length];
    pi++;
    const bi = blocks.length;
    const subTitle = chunk[0].slice(0, 60).split(' ').slice(0, 6).join(' ');
    blocks.push({
      block_index: bi,
      sub_title: subTitle || `${topicTitle} — Key Concepts`,
      visualization_type: viz,
      suggested_template: tpl,
      data: {
        title: subTitle || topicTitle,
        items: chunk.map((c) => ({
          label: c.slice(0, 28).split(' ').slice(0, 3).join(' '),
          desc: c,
          icon: 'mdi/check-circle',
        })),
      },
      caption: captionFromResearch(research, topicTitle),
    });
  }

  // Always make the last block a "Key Takeaways" overview (matches Streamlit)
  // — but only when we have at least one block to convert, and only when the
  // last block isn't already an overview.
  if (blocks.length && blocks[blocks.length - 1].visualization_type !== 'overview') {
    const last = blocks[blocks.length - 1];
    last.visualization_type = 'overview';
    last.suggested_template = 'list-grid-badge-card';
    last.sub_title = 'Key Takeaways';
    last.data.title = `${topicTitle} — Key Takeaways`;
  }
  return blocks.slice(0, target);
}

async function generateContentBlocks(
  topic: SlideTopic,
  research: ResearchEntry,
  courseTitle: string,
  numBlocks: number,
  apiKey: string,
  model?: string,
): Promise<ContentMapEntry> {
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
    ? `\nNOTE: Research data is thin (${sources.length} sources). Use WebSearch to find 1-2 additional sources. Keep searches focused.`
    : '';

  // Cap the first-call ask at SAFE_FIRST_CALL_BLOCKS (12). Asking for 30
  // blocks in one shot blows past the 64K output token cap (each block is
  // ~1.5K tokens of JSON with items + children), causes a JSON-parse fail,
  // and falls back to a 2-3 slide stub with "Source: Course Proposal"
  // captions. The extension loop below adds remaining blocks in 8-block
  // chunks that reliably fit within the token cap.
  const SAFE_FIRST_CALL_BLOCKS = 12;
  const firstAsk = Math.min(numBlocks, SAFE_FIRST_CALL_BLOCKS);

  const prompt = `Create ${firstAsk} content blocks for this topic. Each block = one infographic slide that goes into a Singapore WSQ training PPTX deck.

COURSE: ${courseTitle}
LEARNING UNIT: ${topic.lu_title}
LEARNING OUTCOME: ${topic.lo_description}
TOPIC: ${topic.topic_title}
${bpText}
${researchText}
${researchHint}

═════════════════════════════════════════════════════════════════════════
GOLD STANDARD — match Streamlit's published WSQ deck structure exactly.
Sub-titles below come from a real Streamlit-generated 100-slide deck.
═════════════════════════════════════════════════════════════════════════

Block 0 (overview): "What is {Topic_Title}?" — the introduction slide.

Middle blocks: SPECIFIC, CONCRETE sub-titles that name a real concept,
process, framework, statistic, or comparison from the research. Examples
from a Streamlit-generated deck on AI Ethics:
  • "Key Risk Categories"           (overview/list)
  • "Implementation Process"        (process/sequence)
  • "Approach Comparison"           (comparison)
  • "Governance Framework"          (hierarchy)
  • "Critical Risk Areas"           (overview)
  • "Core Ethical Principles"       (overview)
  • "Traditional vs AI Ethics"      (comparison)
  • "Global Frameworks"             (overview)
  • "Privacy Impact Statistics"     (statistics)
  • "Anonymisation Methods Usage"   (statistics, with %)
  • "Ethics Principles Priority"    (statistics)
  • "Tool Selection Comparison"     (comparison)
  • "Mathematical Frameworks"       (overview)
  • "Bias Mitigation Strategy"      (overview)

NEVER use generic sub-titles like:
  ✗ "What is Security?"  (only block 0 should use the "What is X?" format)
  ✗ "Implement authentication"  (a verb fragment, not a concept name)
  ✗ "Detail 1" / "Point 1" / "Section A"  (placeholder text)
  ✗ "Development with AWS Services — Detail" (truncated/lazy)

Last block (key takeaways): "Key Takeaways" or "Key {Topic} Takeaways"
or "Key Implementation Takeaways" — overview type, summarises the topic.

CAPTION (every block): "Source: {Source Name}, {Year}" using the
research sources. NEVER leave caption empty. Examples from Streamlit:
  "Source: AI Ethics Guidelines, 2024"
  "Source: Framework Analysis across 90+ organizations, WEF 2021"
  "Source: Microsoft Responsible AI Principles, 2024"

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
        "desc": "Brief one-line overview",
        "items": [
          {"label":"Specific Concept Name","desc":"Concrete explanation 6-12 words","icon":"mdi/icon-name"}
        ]
      },
      "caption": "Source: Name, Year",
      "sources_used": ["Source Name"]
    }
    /* ${numBlocks} blocks total, VARY visualization_type */
  ],
  "activity": {
    "title": "Exercise Name",
    "scenario": "Real-world scenario",
    "steps": ["Step 1","Step 2","Step 3"],
    "expected_output": "What learners produce",
    "duration": "20 minutes"
  }
}

MANDATORY BLOCK SEQUENCE:
1. Block 0: "overview" — "What is {Topic_Title}?"
2. Block 1..${firstAsk - 2}: VARY types (process / comparison / statistics / hierarchy / timeline)
   Each must have a SPECIFIC sub-title naming a real concept/framework/process — NOT "Detail 1" / "Point 1".
3. Block ${firstAsk - 1}: "overview" — "Key Takeaways"

RULES:
- EXACTLY ${firstAsk} blocks
- Labels: 2-3 words MAX
- Descriptions: short complete phrase (4-8 words)
- For "comparison": exactly 2 root items
- For "statistics": items MUST have numeric "value"

COMPARISON BLOCKS — quality bar (these slides are visible to learners):
- BANNED labels for the two root items: "Pros" / "Cons", "Advantages" / "Disadvantages",
  "Yes" / "No", "Good" / "Bad", "Old" / "New", "Before" / "After", "+" / "−",
  "A" / "B". These are placeholders, not content.
- USE concrete, topic-specific labels that name what is being compared.
  Examples:
    * "Traditional Interviewing" vs "AI-Assisted Interviewing"
    * "Manual Anonymisation" vs "Automated Anonymisation"
    * "Open-Source Models" vs "Proprietary Models"
    * "Reactive Compliance" vs "Proactive Governance"
- Each root item MUST have:
    * a "label" naming the side (≤3 words)
    * a "desc" giving 4-8 words of substance about that side
    * 2-4 "children" — concrete sub-points that make the comparison real
      (each child has its own label + desc)
- DO NOT produce a comparison block where the only items are "Pros" and "Cons"
  with no children. That renders as an empty Pros/Cons arrow with no learning value.

OVERVIEW / PROCESS / HIERARCHY / TIMELINE BLOCKS — same quality bar:
- Items must be SPECIFIC to the topic. NEVER use generic placeholders like
  "Key Point", "Item 1", "Step 1", "Phase A", "Component". Name the actual
  concept ("Bias Detection", "Stakeholder Mapping", "Model Drift Monitoring").
- "desc" must explain what the item IS, not restate the label.`;

  const tools: string[] = sources.length < 2 ? ['WebSearch'] : [];
  try {
    const result = await runAgentJson({
      prompt,
      systemPrompt: CONTENT_SYSTEM_PROMPT,
      tools,
      maxTurns: 5,
      model: model || FAST_MODEL,
      apiKey,
    });
    let blocks: ContentBlock[] = Array.isArray(result?.content_blocks) ? result.content_blocks : [];

    // Looping extension — call Claude repeatedly in 8-block chunks until we
    // hit the target. Each chunk's prompt names the existing block themes so
    // Claude doesn't duplicate. Bounded by MAX_EXTENSION_PASSES so a stuck
    // model can't loop forever.
    const CHUNK_SIZE = 8;
    const MAX_EXTENSION_PASSES = 4; // up to 32 more blocks beyond the first 12 (44 total)
    let pass = 0;
    while (blocks.length < numBlocks && pass < MAX_EXTENSION_PASSES) {
      const remaining = numBlocks - blocks.length;
      const askThisPass = Math.min(remaining, CHUNK_SIZE);
      if (askThisPass < 2) break; // not worth a call for 1 block
      try {
        const existingSummary = blocks.map((b, i) =>
          `${i + 1}. [${b.visualization_type}] ${b.sub_title}`
        ).join('\n');
        const extPrompt = `Extend the content blocks for this WSQ training topic. The previous passes produced ${blocks.length} blocks; we need ${askThisPass} MORE blocks covering different angles, with the same quality bar.

COURSE: ${courseTitle}
TOPIC: ${topic.topic_title}
LEARNING OUTCOME: ${topic.lo_description}
${bpText}
${researchText}

EXISTING BLOCKS (do NOT duplicate these themes):
${existingSummary}

Generate EXACTLY ${askThisPass} NEW blocks. Use varied visualization_type (process / comparison / statistics / hierarchy / timeline / overview), specific topic-relevant sub_titles, and the same quality rules (no "Pros"/"Cons", no "Point N", real labels with concrete descs).

Return ONLY this JSON:
{
  "content_blocks": [ /* ${askThisPass} new blocks */ ]
}`;
        const ext = await runAgentJson({
          prompt: extPrompt,
          systemPrompt: CONTENT_SYSTEM_PROMPT,
          tools: [],
          maxTurns: 2,
          model: model || FAST_MODEL,
          apiKey,
        });
        const extBlocks: ContentBlock[] = Array.isArray(ext?.content_blocks) ? ext.content_blocks : [];
        if (extBlocks.length === 0) {
          console.warn(`[cw-slides] extension pass ${pass + 1} for '${topic.topic_title}': returned 0 blocks, stopping`);
          break;
        }
        const merged = [...blocks];
        for (const b of extBlocks) {
          merged.push({ ...b, block_index: merged.length });
        }
        blocks = merged;
        console.log(`[cw-slides] '${topic.topic_title}' pass ${pass + 1}: +${extBlocks.length} blocks (${blocks.length}/${numBlocks})`);
      } catch (e: any) {
        console.warn(`[cw-slides] extension pass ${pass + 1} failed for '${topic.topic_title}':`, e.message);
        break;
      }
      pass++;
    }

    // Final pad from real bullets if still short — never invents generic content.
    if (blocks.length < numBlocks) {
      blocks = padContentBlocks(blocks, topic.topic_title, topic.bullet_points, numBlocks, research);
    }
    result.content_blocks = blocks;
    return result as ContentMapEntry;
  } catch (e: any) {
    console.error(`[cw-slides] content failed for '${topic.topic_title}':`, e.message);
    // First attempt died (token limit / parse fail / SDK error). Retry once
    // with a small ask before giving up to fallback. With 6 blocks the
    // model almost always returns clean JSON, even on dense topics.
    try {
      const retryPrompt = `Create 6 content blocks for this WSQ training topic. Each block = one infographic slide.

COURSE: ${courseTitle}
TOPIC: ${topic.topic_title}
LEARNING OUTCOME: ${topic.lo_description}
${bpText}
${researchText}

RULES:
- EXACTLY 6 blocks
- Block 0: "overview" / "What is ${topic.topic_title}?"
- Blocks 1-4: VARY types (process / comparison / statistics / hierarchy / timeline)
- Block 5: "overview" / "Key Takeaways"
- Specific topic-relevant sub_titles. NO "Detail N" / "Point N" / "Pros / Cons".
- "caption" on every block: "Source: {Source Name}, {Year}" using research above.
- 2-5 items per block; each item has label (2-3 words) and desc (4-8 words).

Return ONLY:
{ "content_blocks": [ /* 6 blocks */ ], "activity": { "title": "...", "scenario": "...", "steps": ["...","..."], "expected_output": "...", "duration": "20 minutes" } }`;
      const retry = await runAgentJson({
        prompt: retryPrompt,
        systemPrompt: CONTENT_SYSTEM_PROMPT,
        tools: [],
        maxTurns: 2,
        model: model || FAST_MODEL,
        apiKey,
      });
      const retryBlocks: ContentBlock[] = Array.isArray(retry?.content_blocks) ? retry.content_blocks : [];
      if (retryBlocks.length > 0) {
        console.log(`[cw-slides] retry succeeded for '${topic.topic_title}': ${retryBlocks.length} blocks`);
        return {
          topic: topic.topic_title,
          content_blocks: retryBlocks,
          activity: retry?.activity,
        } as ContentMapEntry;
      }
    } catch (re: any) {
      console.error(`[cw-slides] retry also failed for '${topic.topic_title}':`, re.message);
    }
    return fallbackContentBlocks(topic.topic_title, topic.bullet_points, numBlocks, research);
  }
}

async function generateAllContentBlocks(
  topics: SlideTopic[],
  researchMap: Record<string, ResearchEntry>,
  courseTitle: string,
  perTopicBlocks: number[],
  apiKey: string,
  model?: string,
): Promise<Record<string, ContentMapEntry>> {
  const tasks = topics.map((t, i) => () => generateContentBlocks(
    t,
    researchMap[t.topic_title] ?? fallbackResearch(t.topic_title),
    courseTitle,
    perTopicBlocks[i] || 6,
    apiKey,
    model,
  ));
  const results = await runWithConcurrency(tasks, 5);
  const map: Record<string, ContentMapEntry> = {};
  let fallbackCount = 0;
  results.forEach((r, i) => {
    const key = topics[i].topic_title || `Topic ${i + 1}`;
    if (r instanceof Error) {
      fallbackCount++;
      const research = researchMap[key] ?? fallbackResearch(key);
      map[key] = fallbackContentBlocks(key, topics[i].bullet_points, perTopicBlocks[i] || 6, research);
    } else {
      map[key] = r;
    }
  });
  if (fallbackCount > 0) {
    console.warn(`[cw-slides] ${fallbackCount}/${topics.length} topics fell back (caption will cite research sources, not Course Proposal, when research succeeded)`);
  }
  return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — Skeleton / Editor (deterministic)
// ────────────────────────────────────────────────────────────────────────────

interface SkeletonTopic {
  topic_title: string;
  topic_number: string;
  infographic_assignments: Array<{
    slide_position: number;
    content_block_index: number;
    sub_title: string;
    visualization_type: string;
    assigned_template: string;
  }>;
}

interface SkeletonLu {
  lu_number: string;
  lu_title: string;
  topics: SkeletonTopic[];
}

interface SkeletonLo {
  lo_number: string;
  lo_title: string;
  learning_units: SkeletonLu[];
}

interface Skeleton {
  learning_outcomes: SkeletonLo[];
}

// Template pool per viz type — FULL list matching infographic_agent.TEMPLATE_MAP
// (scripts/courseware_agents/slides/infographic_agent.py). Expanded from my
// earlier truncated list so per-topic variety matches Streamlit.
const SKELETON_TEMPLATE_MAP: Record<string, string[]> = {
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
    // chart-wordcloud removed — renders as floating coloured labels at random
    // sizes with no values, captions, or quantitative content. Useless for
    // training material; the user explicitly asked to drop it.
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

// Per-viz-pool "already used in this deck" set. The pool is exhausted only
// after every template in it has been picked once; only then does a second
// rotation cycle start. Combined with `usedInTopic`, this is the strongest
// variety guarantee possible given finite pool sizes — every infographic in
// the deck uses a different template until the pool runs out.
//
// Pool sizes (templates per viz type):
//   overview: 13   process: 15   comparison: 5   cycle: 4
//   hierarchy: 4   statistics: 8   timeline: 4   relationship: 2   quadrant: 3
// A typical deck has ~80 infographics; the larger pools (overview, process)
// won't repeat for the first 13-15 slides of that type, the smaller ones
// will start their second cycle sooner.
//
// `templateUseCount` is kept as a tie-breaker for choosing which template to
// reuse first when the pool wraps (we pick the least-recently-used).
const templateUseCount = new Map<string, number>();
const deckUsedTemplates = new Map<string, Set<string>>();

function pickTemplate(viz: string, suggested: string, usedInTopic: Set<string>): string {
  const pool = SKELETON_TEMPLATE_MAP[viz] ?? SKELETON_TEMPLATE_MAP.overview;
  let deckUsed = deckUsedTemplates.get(viz);
  if (!deckUsed) {
    deckUsed = new Set<string>();
    deckUsedTemplates.set(viz, deckUsed);
  }

  // Candidates: templates this topic hasn't used AND that haven't been used
  // anywhere else in the deck yet.
  let candidates = pool.filter((t) => !usedInTopic.has(t) && !deckUsed!.has(t));

  // Pool fully cycled in this deck — reset and start a new rotation pass.
  if (!candidates.length) {
    deckUsed.clear();
    candidates = pool.filter((t) => !usedInTopic.has(t));
    if (!candidates.length) candidates = [...pool];
  }

  // Respect the AI's suggestion if it's still in the candidate set.
  let pick: string;
  if (suggested && candidates.includes(suggested)) {
    pick = suggested;
  } else {
    // Otherwise pick the least-used candidate (stable tie-break = pool order).
    let best = candidates[0];
    let bestCount = templateUseCount.get(best) ?? 0;
    for (const t of candidates) {
      const c = templateUseCount.get(t) ?? 0;
      if (c < bestCount) {
        best = t;
        bestCount = c;
      }
    }
    pick = best;
  }

  deckUsed.add(pick);
  templateUseCount.set(pick, (templateUseCount.get(pick) ?? 0) + 1);
  return pick;
}

function resetTemplateCounter() {
  templateUseCount.clear();
  deckUsedTemplates.clear();
}

// Mirrors Python's editor_agent._fuzzy_get_content. The content generator's
// JSON keys often differ from the context's Topic_Title in trivial ways
// (whitespace, case, "T1: " prefix the model adds, punctuation). Without
// fuzzy lookup, exact-match misses cascade through the whole pipeline:
// blocks come back empty → assignments come back empty → infographic
// back-fill kicks in with a per-topic deterministic template index, so
// EVERY topic ends up with the same template sequence (list-grid-badge-card,
// list-grid-candy-card-lite, …). That's what produces the "same model
// repeating across topics" symptom.
function fuzzyGetContent<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (!map || !key) return undefined;
  if (map[key]) return map[key];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.,;:!?()"']/g, '');
  const nk = norm(key);
  if (!nk) return undefined;
  for (const k of Object.keys(map)) {
    if (norm(k) === nk) return map[k];
  }
  // Last-resort: ignore "T1: " / "Topic 1: " prefixes the model sometimes
  // injects when echoing the topic title back.
  const stripPrefix = (s: string) => s.replace(/^(?:t|topic)\s*\d+\s*:\s*/i, '').trim();
  const sk = norm(stripPrefix(key));
  if (sk && sk !== nk) {
    for (const k of Object.keys(map)) {
      if (norm(stripPrefix(k)) === sk) return map[k];
    }
  }
  return undefined;
}

function buildSkeleton(context: any, contentMap: Record<string, ContentMapEntry>): Skeleton {
  // Reset the global template-usage counter so each deck gets fair rotation
  // across the whole pool.
  resetTemplateCounter();
  const lus = context.Learning_Units ?? [];
  const los: SkeletonLo[] = [];
  for (const lu of lus) {
    const loNum = lu.LO_Number || 'LO?';
    const loTitle = lu.LO || '';
    const luNum = lu.LU_Number || 'LU?';
    const luTitle = lu.LU_Title || '';
    const topics: SkeletonTopic[] = [];
    const rawTopics = lu.Topics || [];
    rawTopics.forEach((t: any, tIdx: number) => {
      const tTitle = t.Topic_Title || `Topic ${tIdx + 1}`;
      const blocks = fuzzyGetContent(contentMap, tTitle)?.content_blocks ?? [];
      const usedInTopic = new Set<string>();
      const assignments = blocks.map((b, pos) => {
        const viz = b.visualization_type || 'overview';
        const tpl = pickTemplate(viz, b.suggested_template || '', usedInTopic);
        usedInTopic.add(tpl);
        return {
          slide_position: pos,
          content_block_index: pos,
          sub_title: b.sub_title || tTitle,
          visualization_type: viz,
          assigned_template: tpl,
        };
      });
      topics.push({ topic_title: tTitle, topic_number: `T${tIdx + 1}`, infographic_assignments: assignments });
    });
    let lo = los.find((x) => x.lo_number === loNum);
    if (!lo) { lo = { lo_number: loNum, lo_title: loTitle, learning_units: [] }; los.push(lo); }
    lo.learning_units.push({ lu_number: luNum, lu_title: luTitle, topics });
  }
  return { learning_outcomes: los };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — Infographic agent
// Delegates to generateAllInfographicsImpl (lib/cw-slides-infographic.ts):
// builds AntV DSL deterministically per content block (matches Python's
// disabled-AI-DSL path in scripts/courseware_agents/slides/infographic_agent.py),
// renders the HTML through Playwright Chromium, and writes 1792×1024 PNGs.
// If a slide's PNG fails or is missing, addTopicSlides falls back to
// fallback_bullets (text-only slide).
// ────────────────────────────────────────────────────────────────────────────

interface InfographicResult {
  topic_title: string;
  slide_position: number;
  sub_title: string;
  image_path: string | null;
  caption: string;
  generated: boolean;
  error?: string;
}

async function generateAllInfographics(
  skeleton: Skeleton,
  contentMap: Record<string, ContentMapEntry>,
  outputDir: string,
  _apiKey: string,
  _model?: string,
): Promise<Record<string, InfographicResult[]>> {
  try {
    const raw = await generateAllInfographicsImpl(
      skeleton as unknown as InfographicSkeletonImpl,
      contentMap as unknown as Record<string, InfographicContentEntryImpl>,
      outputDir,
    );
    // Map impl shape → orchestrator shape (1:1 today — just assert required fields)
    const out: Record<string, InfographicResult[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = (v as InfographicResultImpl[]).map((r) => ({
        topic_title: r.topic,
        slide_position: r.slide_position,
        sub_title: r.sub_title || '',
        image_path: r.image_path ?? null,
        caption: r.caption || '',
        generated: r.generated,
        error: r.error,
      }));
    }
    return out;
  } catch (e: any) {
    console.error('[cw-slides] infographic pipeline failed:', e.message);
    return {};
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 — Assembly + PPTX build (pptxgenjs)
// ────────────────────────────────────────────────────────────────────────────

interface AssemblyTopic {
  title: string;
  topic_number: string;
  lo_number: string;
  lo_title: string;
  lu_number: string;
  lu_title: string;
  infographic_slides: Array<{
    position: number;
    title: string;
    image_path: string | null;
    caption: string;
    fallback_bullets: string[];
  }>;
  activity: string[];
}

function formatActivity(activity: ContentMapEntry['activity']): string[] {
  if (!activity) return [];
  const lines: string[] = [];
  if (activity.title) lines.push(`Activity: ${activity.title}`);
  if (activity.scenario) {
    lines.push('');
    lines.push(`Scenario: ${activity.scenario}`);
  }
  const steps = activity.steps || [];
  if (steps.length) {
    lines.push('');
    lines.push('Steps:');
    steps.forEach((s, i) => {
      // Strip any pre-existing "Step N:" / "1." / "1)" / "•" prefix the model
      // may have added so we don't double-number.
      const cleaned = String(s)
        .replace(/^\s*(?:step\s*\d+\s*[:.\-)]\s*|\d+\s*[.)]\s*|[•·\-]\s*)/i, '')
        .trim();
      lines.push(`Step ${i + 1}: ${cleaned}`);
    });
  }
  if (activity.expected_output) {
    lines.push('');
    lines.push(`Expected Output: ${activity.expected_output}`);
  }
  if (activity.duration) {
    lines.push('');
    lines.push(`Duration: ${activity.duration}`);
  }
  return lines;
}

// Quality gate — does this content block have substantive items?
// Quality gate — only reject GENUINELY empty/garbage blocks. Earlier the
// gate was too strict ("desc < 12 chars" / ">50% placeholders" both rejected),
// which dropped ~70% of blocks in production decks and left courses with 2-3
// infographics per topic instead of 6-8. The bar now is just:
//   - block missing entirely, OR
//   - no items at all, OR
//   - items array is purely placeholders (Pros/Cons-only with no children
//     and no descs — the original bug that produced empty "VS" arrows).
// Anything with at least one substantive item (a real label, or a desc
// with any text, or a numeric value) is allowed through.
// Words that mark an item as a generic placeholder rather than topic content.
// Comparison blocks like "Pros vs Cons" render with the LABEL as the giant
// header text, so even if there's a desc the slide LOOKS empty — we treat
// these as thin and either repair (preferred) or drop them.
const PLACEHOLDER_LABEL_RE = /^(?:pros?|cons?|good|bad|yes|no|\+|−|-|a|b|x|y|n\/a|placeholder|advantages?|disadvantages?|positives?|negatives?|benefits?|drawbacks?|old|new|before|after|step\s*\d+|point\s*\d+|item\s*\d+|detail\s*\d+|phase\s*[a-z0-9]+|key\s+point|key\s+aspect|component)\s*$/i;
const PLACEHOLDER_DESC_RE = /^(?:detail\s*\d+|point\s*\d+|step\s*\d+|item\s*\d+|tbd|todo|placeholder|n\/a|none|loremipsum|lorem ipsum)\s*\.?$/i;

function isPlaceholderItem(it: ContentBlockItem | undefined): boolean {
  if (!it) return true;
  const label = String(it.label ?? '').trim();
  const desc = String(it.desc ?? '').trim();
  const hasValue = typeof it.value === 'number' && Number.isFinite(it.value);
  if (!label && !desc && !hasValue) return true;
  // Label is generic placeholder AND desc is also generic/short → placeholder
  if (PLACEHOLDER_LABEL_RE.test(label)) {
    if (!desc || desc.length < 8 || PLACEHOLDER_DESC_RE.test(desc)) return true;
    // Label is "Pros" but desc is real → still placeholder for comparison
    // viz because the rendered image shows the LABEL prominently.
    // We'll let repairBlock fix this; for the thinness check, treat as
    // placeholder UNLESS the desc is substantive (≥20 chars of real text).
    if (desc.length < 20) return true;
  }
  if (PLACEHOLDER_DESC_RE.test(desc)) return true;
  return false;
}

function isBlockThin(block: ContentBlock | undefined): boolean {
  if (!block) return true;
  const items = block.data?.items;
  if (!Array.isArray(items) || items.length === 0) return true;

  // Block is thin only when EVERY item is a placeholder.
  for (const it of items) {
    if (!isPlaceholderItem(it)) return false;
  }
  return true;
}

// Repair a block whose items have placeholder labels but real descriptions.
// Comparison blocks are the main offender (model sometimes returns
// "Pros / Cons" or "Advantages / Disadvantages" despite explicit prompt
// rules). Rather than drop the slide, we rewrite the labels to be topic-
// specific so the rendered PNG has meaningful headers. Returns the
// (possibly mutated) block, or `undefined` if the block is unsalvageable.
function repairBlock(block: ContentBlock, topicTitle: string): ContentBlock | undefined {
  if (!block || !Array.isArray(block.data?.items) || block.data.items.length === 0) {
    return undefined;
  }
  const items = block.data.items;

  // Strip items that are pure placeholders (no rescuable content).
  const survivors = items.filter((it) => {
    const desc = String(it?.desc ?? '').trim();
    const hasValue = typeof it?.value === 'number' && Number.isFinite(it.value);
    return desc.length >= 8 || hasValue;
  });
  if (survivors.length === 0) return undefined; // unsalvageable

  // Rewrite placeholder labels using topic-specific text. Strategy:
  //  - For "comparison" blocks: substitute "Traditional {topic}" / "Modern {topic}"
  //    or use the desc's first 3 words as the new label.
  //  - For other blocks: derive label from desc (first ~3 words).
  const isComparison = String(block.visualization_type ?? '').toLowerCase() === 'comparison';
  const compLabels = [
    `Traditional Approach`,
    `Modern Approach`,
  ];
  let comparisonIdx = 0;

  for (const it of survivors) {
    const label = String(it.label ?? '').trim();
    const desc = String(it.desc ?? '').trim();
    if (PLACEHOLDER_LABEL_RE.test(label) || !label) {
      if (isComparison && comparisonIdx < compLabels.length) {
        // Use Traditional/Modern as the replacement labels for binary comparison
        it.label = compLabels[comparisonIdx];
        comparisonIdx++;
      } else {
        // Derive label from desc first words
        const derived = desc.split(/\s+/).slice(0, 3).join(' ').replace(/[.,;:!?]+$/, '');
        it.label = derived.slice(0, 28) || `${topicTitle} concept`.slice(0, 28);
      }
    }
  }

  block.data.items = survivors;
  return block;
}

// Run repairBlock over every block in the contentMap. Called between Phase 2
// (content generation) and Phase 3 (skeleton building) so downstream phases
// see a clean, label-fixed contentMap.
function repairContentMap(contentMap: Record<string, ContentMapEntry>): void {
  for (const entry of Object.values(contentMap)) {
    const repaired: ContentBlock[] = [];
    for (const block of entry.content_blocks) {
      const fixed = repairBlock(block, entry.topic);
      if (fixed) repaired.push(fixed);
    }
    // Re-index block_index to match new array
    entry.content_blocks = repaired.map((b, i) => ({ ...b, block_index: i }));
  }
}

function assemble(
  skeleton: Skeleton,
  contentMap: Record<string, ContentMapEntry>,
  infographicMap: Record<string, InfographicResult[]>,
): Record<string, { topics: AssemblyTopic[] }> {
  const luMap: Record<string, { topics: AssemblyTopic[] }> = {};
  for (const lo of skeleton.learning_outcomes) {
    for (const lu of lo.learning_units) {
      const topics: AssemblyTopic[] = [];
      for (const t of lu.topics) {
        // Fuzzy lookup mirrors Python — content/infographic generators may
        // echo back slightly altered topic titles (case, whitespace, "T1: "
        // prefix). Without fuzzy match, the topic ends up with no content
        // and the deck shows placeholders / wrong topic content.
        const content = fuzzyGetContent(contentMap, t.topic_title);
        const blocks = content?.content_blocks ?? [];
        const activity = formatActivity(content?.activity);
        const infos = fuzzyGetContent(infographicMap, t.topic_title) ?? [];
        // Quality gate — only DROP a slide entirely when the underlying
        // block is genuinely empty/garbage (isBlockThin). For blocks where
        // the AntV PNG render failed but the content itself is real, fall
        // back to a clean text-bullet slide so the deck still surfaces the
        // material. This keeps slide counts close to the per-day target
        // while still preventing useless empty "VS" placeholder slides.
        type SlideEntry = { position: number; title: string; image_path: string | null; caption: string; fallback_bullets: string[] };
        const infographicSlides: SlideEntry[] = [];
        for (const a of t.infographic_assignments) {
          const block = blocks[a.content_block_index];
          if (isBlockThin(block)) continue; // genuinely empty — drop

          const items = block?.data?.items ?? [];
          const fallback = items
            .filter((it) => String(it.desc ?? '').trim().length >= 3 || typeof it.value === 'number' || String(it.label ?? '').trim().length >= 3)
            .slice(0, 6)
            .map((it) => {
              const desc = String(it.desc ?? '').trim();
              const label = String(it.label ?? '').trim();
              if (desc && label && desc !== label) return `${label}: ${desc}`;
              return desc || label;
            });

          const info = infos.find((i) => i.slide_position === a.slide_position);
          const hasGeneratedImage = !!info?.generated && !!info.image_path;

          infographicSlides.push({
            position: a.slide_position,
            title: a.sub_title,
            image_path: hasGeneratedImage ? info!.image_path : null,
            caption: block?.caption || '',
            fallback_bullets: fallback.length ? fallback : [a.sub_title],
          });
        }
        topics.push({
          title: t.topic_title,
          topic_number: t.topic_number,
          lo_number: lo.lo_number,
          lo_title: lo.lo_title,
          lu_number: lu.lu_number,
          lu_title: lu.lu_title,
          infographic_slides: infographicSlides,
          activity,
        });
      }
      luMap[lu.lu_number] = { topics };
    }
  }
  return luMap;
}

// ────────────────────────────────────────────────────────────────────────────
// Slide builders — EMU-exact port of scripts/generate_slides/build_pptx.py
// All positions expressed in inches (1 inch = 914400 EMU).
// ────────────────────────────────────────────────────────────────────────────

function makePres(): PptxGenJS {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'WSQ_STD', width: SLIDE_W_INCHES, height: SLIDE_H_INCHES });
  pres.layout = 'WSQ_STD';
  return pres;
}

function resolvedCompanyLogo(company?: CwCompanyInfo): string {
  if (!company?.logo) return TERTIARY_LOGO;
  if (path.isAbsolute(company.logo) && fs.existsSync(company.logo)) return company.logo;
  const abs = path.join(PROJECT_ROOT, company.logo);
  if (fs.existsSync(abs)) return abs;
  return TERTIARY_LOGO;
}

function companyName(c?: CwCompanyInfo): string {
  return c?.name || 'Tertiary Infotech Academy Pte Ltd';
}

function companyWebsite(c?: CwCompanyInfo): string {
  return c?.company_url || 'www.tertiarycourses.com.sg';
}

function companyEmail(c?: CwCompanyInfo): string {
  return c?.email || 'enquiry@tertiaryinfotech.com';
}

function copyrightText(c?: CwCompanyInfo): string {
  const name = c?.name || 'Tertiary Infotech Academy Pte Ltd';
  const uen = c?.uen || '201200696W';
  return `This material belongs to ${name} (UEN: ${uen}). All Rights Reserved`;
}

function isTertiary(c?: CwCompanyInfo): boolean {
  return (c?.name || '').toLowerCase().includes('tertiary') || !c?.name;
}

// Strip K/A refs from titles (e.g. "Topic Title (K3, A1)" → "Topic Title")
function cleanKaRefs(text: string): string {
  return String(text || '')
    .replace(/\s*[([]\s*[KA]\d+.*?[)\]]/g, '')
    .replace(/\s*[-–—]\s*[KA]\d+[\s,KA\d]*$/g, '')
    .replace(/\s*[KA]\d+\s*[,&]\s*[KA]\d+[\s,&KA\d]*$/g, '')
    .trim();
}

// ── Footer (copyright bar) — mirrors _add_copyright() ──────────────────────
function addFooter(slide: PptxGenJS.Slide, copyright: string): void {
  // Thin separator line at y=5.38" (EMU 4920000), x=0.33" (300000), w=9.34" (8544000)
  slide.addShape('rect', {
    x: 0.33, y: 5.38, w: 9.34, h: 0.011,
    fill: { color: COLOR_LIGHT_GRAY },
    line: { color: COLOR_LIGHT_GRAY, width: 0.25 },
  });
  // Copyright text at y=5.40" (4940000), x=0.11" (100000), w=9.78" (8944000), h=0.22" (200000)
  slide.addText(copyright, {
    x: 0.11, y: 5.40, w: 9.78, h: 0.22,
    fontSize: 7, color: COLOR_GRAY, fontFace: 'Arial', align: 'center',
  });
}

// ── Body renderer — mirrors _fill_body() ───────────────────────────────────
// Python's _fill_body renders PLAIN TEXT paragraphs — no bullet marks.
// Lines starting with "  " (2 spaces) render at indentLevel=1 with smaller font.
// Empty lines are kept as blank paragraphs so visual spacing matches the
// reference deck exactly.
//
// Auto-shrinks via pptxgenjs `fit: 'shrink'` as a safety net — mirrors the
// auto-fit behaviour of the Python template placeholder. Caller can also
// hint a smaller starting font via opts.fontSize for dense content.
function renderBullets(
  slide: PptxGenJS.Slide,
  lines: string[],
  opts: { x: number; y: number; w: number; h: number; fontSize?: number },
): void {
  const size = opts.fontSize ?? 14;
  const isDense = size <= 10;
  const paraAfter = isDense ? 2 : 6;
  const paraBefore = isDense ? 1 : 2;
  const subSize = Math.min(12, size);

  if (!lines.length) return;

  const runs: Array<{ text: string; options?: any }> = lines.map((raw) => {
    const line = String(raw ?? '');
    if (!line.trim()) {
      return {
        text: ' ',
        options: {
          fontSize: size,
          paraSpaceBefore: paraBefore,
          paraSpaceAfter: paraAfter,
          breakLine: true,
        },
      };
    }
    const isSub = line.startsWith('  ');
    const text = line.replace(/^\s+/, '').trim();
    return {
      text,
      options: {
        indentLevel: isSub ? 1 : 0,
        fontSize: isSub ? subSize : size,
        paraSpaceBefore: paraBefore,
        paraSpaceAfter: paraAfter,
        breakLine: true,
      },
    };
  });

  slide.addText(runs, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    fontFace: 'Arial', color: COLOR_TEXT, valign: 'top', wrap: true,
    fit: 'shrink' as any,
  });
}

// Pick a starting font size that keeps dense bodies within the content box.
// PowerPoint's auto-fit will shrink further if needed, but starting smaller
// avoids visibly-tiny text and preserves typographic hierarchy.
function autoBodyFontSize(lines: string[], defaultSize = 14): number {
  const totalChars = lines.reduce((n, l) => n + String(l ?? '').length, 0);
  const nonEmpty = lines.filter((l) => (l ?? '').toString().trim().length).length;
  if (totalChars > 900 || nonEmpty > 12) return 10;
  if (totalChars > 650 || nonEmpty > 9) return 12;
  if (totalChars > 450 || nonEmpty > 7) return 13;
  return defaultSize;
}

// ── Cover — mirrors add_cover() ────────────────────────────────────────────
function addCoverSlide(pres: PptxGenJS, ctx: any, company: CwCompanyInfo | undefined): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };

  const title = ctx.Course_Title || 'Course Title';
  const tgs = ctx.TGS_Ref_No || ctx.TGS_Number || ctx.Course_Code || '';

  // Title — vertically centered, box h=1.75" (1600000 EMU). x=0.437 (400000), w=9.12 (8344000)
  const titleH = 1.75;
  const titleY = (SLIDE_H_INCHES - titleH) / 2; // ≈ 1.937
  slide.addText(title, {
    x: 0.44, y: titleY, w: 9.12, h: titleH,
    fontSize: 36, bold: true, color: COLOR_NAVY, fontFace: 'Arial',
    align: 'center', valign: 'middle', wrap: true,
  });

  // Logos (bottom-left, stacked). Copyright bar at y=5.38", so logos sit above.
  // Python uses PIL to calc aspect; we approximate with pptxgenjs contain sizing.
  const LOGO_X = 0.33;                       // 300000 EMU
  const MAX_LOGO_W = 2.73;                   // 2500000 EMU
  const MAX_LOGO_H = 0.875;                  // 800000 EMU
  const LOGO_GAP = 0.11;                     // 100000 EMU
  const COPY_Y = 5.38;                       // 4920000 EMU
  const BOTTOM_MARGIN = 0.087;               // 80000 EMU

  const companyLogo = resolvedCompanyLogo(company);
  const wsqExists = fs.existsSync(WSQ_LOGO);
  const coExists = fs.existsSync(companyLogo);
  // Approximate stacking: assume each logo fills MAX_LOGO_H; layout bottom-up
  const wsqH = wsqExists ? MAX_LOGO_H : 0;
  const coH = coExists ? MAX_LOGO_H * 0.7 : 0; // company logo slightly shorter
  const totalH = wsqH + (wsqExists && coExists ? LOGO_GAP : 0) + coH;
  const wsqY = COPY_Y - BOTTOM_MARGIN - totalH;
  const coY = wsqY + wsqH + LOGO_GAP;

  if (wsqExists) {
    slide.addImage({
      path: WSQ_LOGO, x: LOGO_X, y: wsqY, w: MAX_LOGO_W, h: MAX_LOGO_H,
      sizing: { type: 'contain', w: MAX_LOGO_W, h: MAX_LOGO_H },
    });
  }
  if (coExists) {
    slide.addImage({
      path: companyLogo, x: LOGO_X, y: coY, w: MAX_LOGO_W, h: MAX_LOGO_H * 0.7,
      sizing: { type: 'contain', w: MAX_LOGO_W, h: MAX_LOGO_H * 0.7 },
    });
  }

  // Version / course-code / website (bottom-right, aligned with company logo)
  const infoLines: { text: string }[] = [{ text: 'Version: 1.0' }];
  if (tgs) infoLines.push({ text: `Course Code: ${tgs}` });
  infoLines.push({ text: `Website: ${companyWebsite(company)}` });

  slide.addText(
    infoLines.map((l, i) => ({
      text: l.text,
      options: { breakLine: i < infoLines.length - 1 },
    })),
    {
      x: 6.01, y: coY, w: 3.83, h: 0.77,
      fontSize: 12, color: '000000', fontFace: 'Arial', align: 'right', valign: 'top',
    },
  );

  addFooter(slide, copyrightText(company));
}

// ── Section header — mirrors add_section() — NO copyright footer! ──────────
function addSectionSlide(pres: PptxGenJS, text: string): void {
  const clean = cleanKaRefs(text);
  const slide = pres.addSlide();
  slide.background = { color: COLOR_NAVY };

  // Top accent bar: x=0, y=0, w=10", h=0.087" (80000 EMU)
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W_INCHES, h: 0.087,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });

  // Centered title: x=0.547 (500000), y=1.97 (1800000), w=8.91 (8144000), h=1.64 (1500000)
  slide.addText(clean, {
    x: 0.547, y: 1.97, w: 8.91, h: 1.64,
    fontSize: 32, bold: true, color: COLOR_WHITE, fontFace: 'Arial',
    align: 'center', valign: 'middle', wrap: true,
  });

  // Bottom accent bar: y=5.538 (5063500 EMU), h=0.087
  slide.addShape('rect', {
    x: 0, y: 5.538, w: SLIDE_W_INCHES, h: 0.087,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });
}

// ── Title + body (tb_slide) — mirrors add_tb_slide() ───────────────────────
function addTitleBodySlide(
  pres: PptxGenJS,
  title: string,
  lines: string[],
  company: CwCompanyInfo | undefined,
  fontSize = 14,
): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };

  // Title (placeholder idx 0) — x=0.165 (151275), y=0.05, w=9.67, h=0.57
  slide.addText(cleanKaRefs(title), {
    x: 0.165, y: 0.05, w: 9.67, h: 0.57,
    fontSize: 20, bold: true, color: COLOR_NAVY, fontFace: 'Arial',
    valign: 'middle', wrap: true,
  });

  // Teal accent bar under title: x=0.165, y=0.626 (572700), w=8.75 (8000000), h=0.033 (30000)
  slide.addShape('rect', {
    x: 0.165, y: 0.626, w: 8.75, h: 0.033,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });

  // Body: x=0.165, y=0.71 (650000), w=9.668 (8841450), h=4.614 (4220000)
  renderBullets(slide, lines, { x: 0.165, y: 0.71, w: 9.668, h: 4.614, fontSize });

  addFooter(slide, copyrightText(company));
}

// ── Title-only slide — mirrors _add_title_only_slide() ─────────────────────
function addTitleOnlySlide(pres: PptxGenJS, title: string, company: CwCompanyInfo | undefined): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };
  slide.addText(title, {
    x: 0.165, y: 0.11, w: 9.62, h: 0.66,
    fontSize: 24, bold: true, color: COLOR_NAVY, fontFace: 'Arial', align: 'center',
  });
  addFooter(slide, copyrightText(company));
}

// ── Title + image slide — mirrors _add_title_image_slide() ─────────────────
function addTitleImageSlide(pres: PptxGenJS, title: string, imagePath: string, company: CwCompanyInfo | undefined): void {
  if (!fs.existsSync(imagePath)) {
    addTitleBodySlide(pres, title, [`[Image placeholder — place image at: ${imagePath}]`], company);
    return;
  }
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };
  slide.addText(title, {
    x: 0.165, y: 0.11, w: 9.62, h: 0.66,
    fontSize: 24, bold: true, color: COLOR_NAVY, fontFace: 'Arial', align: 'center',
  });
  // Image: x=0.33 (300000), y=0.77 (700000), w=9.29 (8500000), h=4.48 (4100000)
  slide.addImage({
    path: imagePath, x: 0.33, y: 0.77, w: 9.29, h: 4.48,
    sizing: { type: 'contain', w: 9.29, h: 4.48 },
  });
  addFooter(slide, copyrightText(company));
}

// ── Infographic slide — mirrors add_infographic_slide() ────────────────────
function addInfographicSlide(
  pres: PptxGenJS,
  title: string,
  imagePath: string | null,
  caption: string,
  company: CwCompanyInfo | undefined,
): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };

  // Title: enlarged title box with auto-shrink so long sub_titles like
  // "Implement authentication and/or authorization for AWS resources" wrap
  // cleanly to 2 lines instead of getting clipped on a 0.44" tall band.
  const cleanTitle = cleanKaRefs(title) || '';
  const titleSize = cleanTitle.length > 70 ? 14 : cleanTitle.length > 50 ? 16 : 18;
  slide.addText(cleanTitle, {
    x: 0.17, y: 0.08, w: 9.62, h: 0.62,
    fontSize: titleSize, bold: true, color: COLOR_NAVY, fontFace: 'Arial',
    valign: 'middle', wrap: true, fit: 'shrink', autoFit: true,
  } as any);

  // Thin teal separator: nudged down to match the wider title box.
  slide.addShape('rect', {
    x: 0.17, y: 0.71, w: 9.62, h: 0.02,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });

  // Image area: x=1.15 (1051000), y=0.68 (621000), w=7.66 (7004000), h=4.37 (3996000)
  if (imagePath && fs.existsSync(imagePath)) {
    slide.addImage({
      path: imagePath, x: 1.15, y: 0.68, w: 7.66, h: 4.37,
      sizing: { type: 'contain', w: 7.66, h: 4.37 },
    });
  }

  // Source caption: x=0.17, y=5.14 (4700000), w=9.62, h=0.27 (247000)
  if (caption) {
    slide.addText(caption, {
      x: 0.17, y: 5.14, w: 9.62, h: 0.27,
      fontSize: 9, italic: true, color: COLOR_GRAY, fontFace: 'Arial', align: 'left',
    });
  }

  addFooter(slide, copyrightText(company));
}

// ── Activity slide — mirrors add_activity() ────────────────────────────────
// Activity text is often long (scenario + 5 steps + expected output + duration).
// Auto-shrink font AND enforce body height = copyright_y − body_y so content
// can't overflow under the footer line.
function addActivitySlide(pres: PptxGenJS, topicTitle: string, steps: string[], company: CwCompanyInfo | undefined): void {
  const fullTitle = `Activity: ${cleanKaRefs(topicTitle)}`;
  // Wider title band + larger title font so it doesn't get clipped on long
  // topic titles. Title shrinks gradually only on extreme lengths.
  const titleSize = fullTitle.length > 90 ? 20 : fullTitle.length > 65 ? 22 : 26;
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };

  // Title band: y=0.20, h=0.95 — gives the longer activity title two lines if needed.
  slide.addText(fullTitle, {
    x: 0.33, y: 0.20, w: 9.34, h: 0.95,
    fontSize: titleSize, bold: true, color: COLOR_NAVY, fontFace: 'Arial', valign: 'middle', wrap: true,
  });
  // Teal underline beneath title
  slide.addShape('rect', {
    x: 0.33, y: 1.20, w: 9.34, h: 0.04,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });

  // Body sits below the underline. Usable h = 5.38 (footer line) − 1.32 (body top)
  // − 0.05 gap = 4.01". Use a richer renderer that styles labels in bold and
  // gives steps proper indentation, instead of the plain renderBullets bullets.
  const bodyTop = 1.32;
  const bodyHeight = 4.01;
  renderActivityBody(slide, steps, { x: 0.33, y: bodyTop, w: 9.34, h: bodyHeight });
  addFooter(slide, copyrightText(company));
}

// Render the activity slide body with a clear visual hierarchy:
//   - Section labels ("Activity:", "Scenario:", "Steps:", "Expected Output:",
//     "Duration:") render in bold navy.
//   - "Step N:" prefixes render in bold teal.
//   - Body text renders in normal weight at a comfortable reading size
//     (~16pt with auto-shrink only when content overflows).
function renderActivityBody(
  slide: PptxGenJS.Slide,
  lines: string[],
  opts: { x: number; y: number; w: number; h: number },
): void {
  const totalChars = lines.reduce((n, l) => n + String(l ?? '').length, 0);
  const nonEmpty = lines.filter((l) => (l ?? '').toString().trim().length).length;
  // Activity bodies routinely run 700-1100 chars across 12-15 lines (Activity
  // title + Scenario + Steps header + 4-5 steps + Expected Output + Duration,
  // with blank-line spacers). Tightened thresholds + lower baseline so the
  // last step doesn't bleed past the body box into the footer area.
  let size = 16;
  if (totalChars > 1000 || nonEmpty > 14) size = 11;
  else if (totalChars > 800 || nonEmpty > 12) size = 12;
  else if (totalChars > 600 || nonEmpty > 10) size = 13;
  else if (totalChars > 450 || nonEmpty > 8) size = 14;

  const SECTION_LABELS = ['Activity:', 'Scenario:', 'Steps:', 'Expected Output:', 'Duration:'];

  type Run = { text: string; options?: PptxGenJS.TextPropsOptions };
  const allRuns: Run[] = [];

  lines.forEach((line, i) => {
    const text = String(line ?? '');
    const isLast = i === lines.length - 1;

    if (text === '') {
      // Empty paragraph for visual spacing
      allRuns.push({ text: ' ', options: { fontSize: Math.max(8, size - 6), breakLine: !isLast } });
      return;
    }

    // "Step N: …" → bold teal prefix + normal black body
    const stepMatch = text.match(/^(Step\s+\d+:)\s*(.*)$/);
    if (stepMatch) {
      allRuns.push({
        text: stepMatch[1] + ' ',
        options: { fontSize: size, bold: true, color: COLOR_TEAL, fontFace: 'Arial' },
      });
      allRuns.push({
        text: stepMatch[2],
        options: { fontSize: size, color: COLOR_TEXT, fontFace: 'Arial', breakLine: !isLast },
      });
      return;
    }

    // "Activity: / Scenario: / Steps: / Expected Output: / Duration:" labels
    const sectionLabel = SECTION_LABELS.find((lbl) =>
      text.startsWith(lbl) || text.startsWith(lbl.replace(':', '')) === false && text.startsWith(lbl),
    );
    if (sectionLabel && (text === sectionLabel || text.startsWith(sectionLabel + ' ') || text.startsWith(sectionLabel))) {
      const rest = text.slice(sectionLabel.length).trim();
      allRuns.push({
        text: sectionLabel + (rest ? ' ' : ''),
        options: { fontSize: size, bold: true, color: COLOR_NAVY, fontFace: 'Arial' },
      });
      if (rest) {
        allRuns.push({
          text: rest,
          options: { fontSize: size, color: COLOR_TEXT, fontFace: 'Arial', breakLine: !isLast },
        });
      } else {
        allRuns.push({
          text: '',
          options: { fontSize: size, breakLine: !isLast },
        });
      }
      return;
    }

    // Plain body line
    allRuns.push({
      text,
      options: { fontSize: size, color: COLOR_TEXT, fontFace: 'Arial', breakLine: !isLast },
    });
  });

  slide.addText(allRuns as any, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    valign: 'top', wrap: true,
    autoFit: true, fit: 'shrink',
    // Tighter paragraph spacing keeps long activities (5+ steps) inside the
    // body box. Each empty-line spacer between sections still provides clear
    // visual separation because it inherits this paraSpaceAfter too.
    paraSpaceAfter: 4, paraSpaceBefore: 0,
  } as any);
}

// ── Certificate slide — mirrors add_certificate() ──────────────────────────
function addCertificateSlide(pres: PptxGenJS, tscCode: string, company: CwCompanyInfo | undefined): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR_WHITE };

  slide.addText('Certificate of Accomplishment', {
    x: 0.165, y: 0.05, w: 9.67, h: 0.57,
    fontSize: 20, bold: true, color: COLOR_NAVY, fontFace: 'Arial', valign: 'middle',
  });
  slide.addShape('rect', {
    x: 0.165, y: 0.626, w: 8.75, h: 0.033,
    fill: { color: COLOR_TEAL }, line: { color: COLOR_TEAL, width: 0 },
  });

  const lines: string[] = ['Upon successful completion you will receive:', ''];
  if (tscCode) lines.push(`  WSQ Statement of Attainment (SOA) - ${tscCode}`);
  else lines.push('  WSQ Statement of Attainment (SOA)');
  lines.push(
    `  Certificate from ${companyName(company)}`,
    '',
    'Requirements:',
    '  Minimum 75% attendance',
    '  Achieve \u2018Competent\u2019 in assessment',
    '  Complete TRAQOM survey',
  );

  // Body on left (narrower), cert image on right — mirrors Python
  // Image: x=6.56 (6000000), y=0.77 (700000), h=4.15 (3800000), keep aspect
  const hasCert = isTertiary(company) && fs.existsSync(CERT_TEMPLATE);
  const bodyW = hasCert ? 6.30 : 9.668;
  renderBullets(slide, lines, { x: 0.165, y: 0.71, w: bodyW, h: 4.614, fontSize: 12 });
  if (hasCert) {
    slide.addImage({
      path: CERT_TEMPLATE, x: 6.56, y: 0.77, w: 3.28, h: 4.15,
      sizing: { type: 'contain', w: 3.28, h: 4.15 },
    });
  }

  addFooter(slide, copyrightText(company));
}

// ────────────────────────────────────────────────────────────────────────────
// Standard intro slides (10 total) — exact content match with build_pptx.py
// ────────────────────────────────────────────────────────────────────────────
function addIntroSlides(pres: PptxGenJS, ctx: any, company: CwCompanyInfo | undefined): void {
  const courseTitle = ctx.Course_Title || 'Course';
  const tgsCode = ctx.TGS_Ref_No || ctx.TGS_Number || ctx.Course_Code || '';
  const tscCode = ctx.TSC_Code || '';
  const tscTitle = ctx.TSC_Title || '';
  const lus = Array.isArray(ctx.Learning_Units) ? ctx.Learning_Units : [];

  // 1. Cover
  addCoverSlide(pres, ctx, company);

  // 2. Digital Attendance (Mandatory)
  addTitleBodySlide(pres, 'Digital Attendance (Mandatory)', [
    'It is mandatory for you to take both AM, PM and Assessment digital attendance for WSQ funded courses.',
    '',
    'The trainer or administrator will show you the digital attendance QR code generated from SSG portal.',
    '',
    'Please scan the QR code from your mobile phone camera and submit your attendance.',
  ], company);

  // 3. About the Trainer (title-only placeholder)
  addTitleOnlySlide(pres, 'About the Trainer', company);

  // 4. Let's Know Each Other — icebreaker image
  addTitleImageSlide(pres, "Let's Know Each Other...", LETS_KNOW_IMG, company);

  // 5. Ground Rules
  addTitleBodySlide(pres, 'Ground Rules', [
    'Set your mobile phone to silent mode',
    'Actively participate in the class. No question is stupid.',
    'Respect each other views. Agree to disagree.',
    'Each person should only speak one at a time.',
    'Be punctual. Back from breaks on time.',
    'Exit the class silently if you need to step out for phone call, toilet break etc.',
    '75% attendance is required for WSQ funding eligibility.',
  ], company);

  // 6. Skills Framework
  const sf: string[] = [];
  if (tscTitle) sf.push(`TSC Title: ${tscTitle}`);
  if (tscCode) sf.push(`TSC Code: ${tscCode}`);
  const tscDesc = ctx.TSC_Description || ctx.Proficiency_Description || '';
  if (tscDesc) sf.push('', `TSC Description: ${String(tscDesc).slice(0, 300)}`);
  if (ctx.Proficiency_Level) sf.push(`Proficiency Level: ${ctx.Proficiency_Level}`);
  sf.push('', 'Learning Outcomes:');
  lus.forEach((lu: any, i: number) => {
    const luNum = lu.LU_Number || `LU${i + 1}`;
    const luTitle = lu.LU_Title || '';
    const lo = lu.LO || '';
    let loDesc = lu.LO_Description || '';
    if (loDesc && loDesc.length > 120) loDesc = loDesc.slice(0, 117) + '...';
    const loText = loDesc ? `${lo}: ${loDesc}` : lo;
    sf.push(`  ${luNum} (${luTitle})`);
    sf.push(`    ${loText}`);
  });
  if (sf.length) addTitleBodySlide(pres, 'Skills Framework', sf, company, 10);

  // 7. Knowledge & Ability Statements
  const ka: string[] = [];
  for (let i = 0; i < lus.length; i++) {
    const lu = lus[i];
    const luNum = lu.LU_Number || `LU${i + 1}`;
    const luTitle = lu.LU_Title || '';
    const kList = lu.K_numbering_description || lu.K_Statements || [];
    const aList = lu.A_numbering_description || lu.A_Statements || [];
    if (kList.length || aList.length) {
      ka.push(`${luNum}: ${luTitle}`);
      for (const k of kList) {
        if (k && typeof k === 'object') {
          let d = k.Description || '';
          if (d.length > 150) d = d.slice(0, 147) + '...';
          ka.push(`  ${k.K_number || ''}: ${d}`);
        } else if (typeof k === 'string') ka.push(`  ${k.slice(0, 150)}`);
      }
      for (const a of aList) {
        if (a && typeof a === 'object') {
          let d = a.Description || '';
          if (d.length > 150) d = d.slice(0, 147) + '...';
          ka.push(`  ${a.A_number || ''}: ${d}`);
        } else if (typeof a === 'string') ka.push(`  ${a.slice(0, 150)}`);
      }
      ka.push('');
    }
  }
  if (ka.length) {
    const nonEmpty = ka.filter((l) => l.trim()).length;
    const kaFont = nonEmpty > 20 ? 7 : nonEmpty > 14 ? 8 : 10;
    addTitleBodySlide(pres, 'Knowledge & Ability Statements', ka, company, kaFont);
  }

  // 8. Course Outline
  const outline: string[] = [];
  lus.forEach((lu: any, i: number) => {
    const luNum = lu.LU_Number || `LU${i + 1}`;
    const luTitle = lu.LU_Title || '';
    outline.push(`${luNum}: ${luTitle}`);
    (lu.Topics || []).forEach((t: any, ti: number) => {
      outline.push(`  T${ti + 1}: ${t.Topic_Title || ''}`);
    });
    outline.push('');
  });
  if (outline.length) {
    const nonEmpty = outline.filter((l) => l.trim()).length;
    const outFont = nonEmpty > 16 ? 7 : nonEmpty > 12 ? 8 : nonEmpty > 8 ? 9 : 10;
    addTitleBodySlide(pres, 'Course Outline', outline, company, outFont);
  }

  // 9. Assessment Methods & Briefing
  const assessMethod = ctx.Assessment_Method || ctx.Mode_of_Assessment || 'Written Assessment';
  addTitleBodySlide(pres, 'Assessment Methods & Briefing', [
    `Assessment: ${assessMethod}`,
    '',
    'Assessment format: Open Book',
    'Open book assessment allows you to reference your learning materials.',
    '',
    'Duration: As per course schedule',
    'Grading: Competent / Not Yet Competent',
    '',
    'Assessment Rules:',
    '  Place phones & other materials under the table',
    '  No photos or recording of assessment scripts',
    '  No discussion with other learners during assessment',
    '  Raise your hand if you have any questions',
  ], company);

  // 10. Criteria for Funding
  addTitleBodySlide(pres, 'Criteria for Funding', [
    'Minimum attendance rate of 75% based on SSG Digital Attendance record.',
    'Complete the assessment and be assessed as \u2018Competent\u2019.',
    'Complete the TRAQOM survey.',
    '',
    'For more information on WSQ funding:',
    'Visit SkillsFuture portal: www.skillsfuture.gov.sg',
    '',
    'Eligible individuals may use SkillsFuture Credit to offset course fees.',
  ], company);
  // (unused vars silencer)
  void courseTitle; void tgsCode;
}

// ────────────────────────────────────────────────────────────────────────────
// Standard closing slides (7 total) — exact content match with build_pptx.py
// ────────────────────────────────────────────────────────────────────────────
function addClosingSlides(pres: PptxGenJS, ctx: any, company: CwCompanyInfo | undefined): void {
  const tscCode = ctx.TSC_Code || '';

  // 1. Summary & Q&A (section)
  addSectionSlide(pres, 'Summary & Q&A');

  // 2. TRAQOM Survey
  addTitleBodySlide(pres, 'TRAQOM Survey', [
    'Access the survey here',
    'Key in your last four NRIC/FIN characters and the six-digit course run ID',
    '',
    'Your feedback helps us improve training quality',
    'The survey is mandatory for WSQ-funded courses',
    'Takes approximately 5-10 minutes',
    'All responses are confidential',
  ], company);

  // 3. Certificate of Accomplishment
  addCertificateSlide(pres, tscCode, company);

  // 4. Digital Attendance (end)
  addTitleBodySlide(pres, 'Digital Attendance', [
    'It is mandatory for you to take both AM, PM and Assessment digital attendance.',
    '',
    'Please scan the QR code from your mobile phone camera and submit your attendance.',
    '',
    'Ensure your attendance is recorded for all course days.',
    'This is required for funding and certification purposes.',
  ], company);

  // 5. Final Assessment (section)
  addSectionSlide(pres, 'Final Assessment');

  // 6. Support
  if (isTertiary(company)) {
    addTitleBodySlide(pres, 'Support', [
      'If you have any enquiries during and after the class, you can contact us below',
      '',
      '  Email: enquiry@tertiaryinfotech.com',
      '  Tel: +65 6318 4588',
      '  Website: www.tertiarycourses.com.sg',
    ], company);
  } else {
    addTitleBodySlide(pres, 'Support', [
      'If you have any enquiries during and after the class, you can contact us below',
      '',
      `  Email: ${companyEmail(company)}`,
      '  Tel: ',
      `  Website: ${companyWebsite(company)}`,
    ], company);
  }

  // 7. Thank You (section)
  addSectionSlide(pres, 'Thank You!');
}

// ────────────────────────────────────────────────────────────────────────────
// Topic builder — mirrors build_infographic_topic_slides()
// Section header: "LO? | LU? | Topic N: Title", then one infographic per
// content block, then activity slide.
// ────────────────────────────────────────────────────────────────────────────
function addTopicSlides(
  pres: PptxGenJS,
  topic: AssemblyTopic,
  topicIdx: number,
  company: CwCompanyInfo | undefined,
): number {
  let slidesAdded = 0;
  const title = cleanKaRefs(topic.title);

  // Section header: "LO1 | LU1 | Topic 1: Title"
  const topicLabel = `Topic ${topicIdx + 1}: ${title.replace(/^Topic\s*\d+\s*:\s*/, '').trim() || title}`;
  const parts: string[] = [];
  if (topic.lo_number) parts.push(topic.lo_number);
  if (topic.lu_number) parts.push(topic.lu_number);
  parts.push(topicLabel);
  addSectionSlide(pres, parts.join(' | '));
  slidesAdded++;

  // Infographic content slides. Prefer the rendered PNG when available;
  // when Playwright failed for a particular block but the content itself
  // is substantive, fall back to a clean text-bullet slide so the topic
  // still surfaces that material. Only blocks `assemble` already filtered
  // (genuinely empty) reach this loop, so no garbage slides slip through.
  for (const s of topic.infographic_slides) {
    if (s.image_path && fs.existsSync(s.image_path)) {
      addInfographicSlide(pres, s.title, s.image_path, s.caption || '', company);
    } else if (s.fallback_bullets?.length) {
      addTitleBodySlide(pres, s.title, s.fallback_bullets, company);
    } else {
      continue;
    }
    slidesAdded++;
  }

  // Activity slide
  if (topic.activity && topic.activity.length) {
    addActivitySlide(pres, title, topic.activity, company);
    slidesAdded++;
  }
  return slidesAdded;
}

// ────────────────────────────────────────────────────────────────────────────
// LU builder — add all topics in order (no LU section header — topic headers
// already carry the LO|LU|T prefix, matching build_pptx.py's flat flow).
// ────────────────────────────────────────────────────────────────────────────
function addLuSlides(
  pres: PptxGenJS,
  lu: { topics: AssemblyTopic[] },
  company: CwCompanyInfo | undefined,
): number {
  let added = 0;
  for (let i = 0; i < lu.topics.length; i++) {
    added += addTopicSlides(pres, lu.topics[i], i, company);
  }
  return added;
}

async function buildPptxBuffer(
  ctx: any,
  skeleton: Skeleton,
  luDataMap: Record<string, { topics: AssemblyTopic[] }>,
  company: CwCompanyInfo | undefined,
  slideTarget: number,
): Promise<{ buffer: Buffer; slideCount: number }> {
  const pres = makePres();
  addIntroSlides(pres, ctx, company);

  for (const lo of skeleton.learning_outcomes) {
    for (const lu of lo.learning_units) {
      const luData = luDataMap[lu.lu_number] ?? { topics: [] };
      addLuSlides(pres, luData, company);
    }
  }

  // NO padding — Streamlit reference never pads; it accepts whatever slide
  // count the content pipeline naturally produces (~98 for a 1-day course
  // targeted at 100). Padding previously recycled existing infographic PNGs,
  // producing visible duplicates across the deck. Leaving slideTarget/
  // CLOSING_SLIDES_COUNT imports touched only so the caller-visible stats
  // remain consistent.
  void slideTarget;
  void CLOSING_SLIDES_COUNT;

  addClosingSlides(pres, ctx, company);

  // Write to temp file, read back as buffer (pptxgenjs writeFile -> path,
  // in Node: use `write` which returns Buffer/ArrayBuffer depending on env).
  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  const finalSlides = (pres as any)._slides?.length ?? 0;
  const cleaned = scrubPptxBuffer(out);
  return { buffer: cleaned, slideCount: finalSlides };
}

// pptxgenjs emits a zero-dim group-shape transform on every slide:
//   <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
//   <a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
// PowerPoint flags this as invalid (group shape with zero extent) and shows
// the "found a problem with content / Repair" dialog every time the user
// opens the deck. python-pptx (used by Streamlit) emits `<p:grpSpPr/>`
// instead and PowerPoint accepts that cleanly. This post-processor strips
// the zero-dim xfrm out of every slide XML so the deck opens cleanly.
function scrubPptxBuffer(buf: Buffer): Buffer {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PizZip = require('pizzip');
    const zip = new PizZip(buf);
    const files = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
    const reZeroXfrm = /<p:grpSpPr>\s*<a:xfrm>\s*<a:off x="0" y="0"\/>\s*<a:ext cx="0" cy="0"\/>\s*<a:chOff x="0" y="0"\/>\s*<a:chExt cx="0" cy="0"\/>\s*<\/a:xfrm>\s*<\/p:grpSpPr>/g;
    for (const f of files) {
      const text = f.asText();
      const cleaned = text.replace(reZeroXfrm, '<p:grpSpPr/>');
      if (cleaned !== text) {
        zip.file(f.name, cleaned);
      }
    }
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  } catch (e: any) {
    console.warn('[cw-slides] scrubPptxBuffer failed, returning original:', e?.message);
    return buf;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public orchestrator
// ────────────────────────────────────────────────────────────────────────────

export async function generateSlides(
  contextIn: any,
  apiKey: string,
  config: SlideAgentConfig = {},
  progress?: (msg: string, pct: number) => void,
): Promise<SlidesResult> {
  const ctx = normaliseContext(contextIn) || {};
  const model = config.model || DEFAULT_MODEL;
  const company = config.company;

  const courseTitle = String(ctx.Course_Title || 'Course');
  const lus = Array.isArray(ctx.Learning_Units) ? ctx.Learning_Units : [];

  // Parse hours. Three layers of fallback so the deck size correctly tracks
  // the real course duration regardless of CP format (legacy table, new
  // SSG WSQ form, DOCX prose, or odd Claude extraction misses):
  //   1. Try every structured field Phase 0 may have populated (hours
  //      OR days; PascalCase OR camelCase).
  //   2. If still <8h, run extractDurationHoursFromText on the raw CP
  //      text — that scans every plausible "Total X Duration / Hours /
  //      Days" pattern and picks the largest plausible total.
  //   3. If the CP genuinely has no duration info, fall back to topic-
  //      count heuristic (caps at 8h floor).
  const totalTopics = lus.reduce((n: number, lu: any) => n + (Array.isArray(lu.Topics) ? lu.Topics.length : 0), 0);
  const candidateFields = [
    ctx.Total_Course_Duration_Hours,
    ctx.Total_Course_Duration,
    ctx.Total_Training_Hours,
    ctx.Total_Training_Duration,
    ctx.Total_Instructional_Duration,
    ctx.totalTrainingHours,
    ctx.totalCourseDuration,
  ];
  let hours = 0;
  let resolvedFrom = 'none';
  for (const field of candidateFields) {
    const h = parseHours(field);
    if (h >= 1) {
      hours = h;
      resolvedFrom = `field='${field}'`;
      break;
    }
  }
  if (hours < 8) {
    const fromText = extractDurationHoursFromText(String(ctx._cp_text ?? ''));
    if (fromText >= 1) {
      hours = fromText;
      resolvedFrom = `cp-text scan (${fromText}h)`;
    }
  }
  if (hours < 1 && totalTopics > 0) {
    hours = Math.max(8, totalTopics * 2);
    resolvedFrom = `topic-count heuristic (${totalTopics} topics × 2)`;
  }
  if (hours < 8) hours = 8;
  console.log(`[cw-slides] duration resolved: ${hours}h from ${resolvedFrom} → target=${computeTotalTarget(hours)} slides (${totalTopics} topics)`);
  const target = computeTotalTarget(hours);
  const perTopic = computePerTopicDistribution(hours, Math.max(1, totalTopics));

  // Flatten topics
  const allTopics: SlideTopic[] = [];
  for (const lu of lus) {
    for (const t of lu.Topics || []) {
      allTopics.push({
        topic_title: t.Topic_Title || 'Topic',
        bullet_points: Array.isArray(t.Bullet_Points) ? t.Bullet_Points : [],
        lo_description: lu.LO || '',
        lu_title: lu.LU_Title || '',
      });
    }
  }

  // ── Phase 1: Research
  progress?.(`Phase 1/5: Researching ${allTopics.length} topics...`, 5);
  const researchMap = allTopics.length
    ? await researchAllTopics(allTopics, courseTitle, apiKey, model)
    : {};
  const researched = Object.values(researchMap).filter((r) => (r.sources || []).length > 0).length;
  const totalSources = Object.values(researchMap).reduce((n, r) => n + (r.sources?.length || 0), 0);
  progress?.(`Phase 1/5: Research complete — ${researched}/${allTopics.length} topics, ${totalSources} sources`, 20);

  // ── Phase 2: Content blocks
  progress?.('Phase 2/5: Generating content blocks...', 25);
  const contentMap = allTopics.length
    ? await generateAllContentBlocks(allTopics, researchMap, courseTitle, perTopic, apiKey, model)
    : {};

  // Repair pass: scrub placeholder labels (Pros/Cons/Detail N/Step 1) so
  // Phase 4 doesn't render infographics with empty-looking headers. This
  // catches the case where the model returned descriptions but kept the
  // banned generic label words despite the prompt's BANNED rules.
  repairContentMap(contentMap);

  const totalBlocks = Object.values(contentMap).reduce((n, c) => n + c.content_blocks.length, 0);
  progress?.(`Phase 2/5: Content blocks — ${totalBlocks} blocks across ${Object.keys(contentMap).length} topics`, 40);

  // ── Phase 3: Skeleton
  progress?.('Phase 3/5: Building deck skeleton...', 45);
  const skeleton = buildSkeleton(ctx, contentMap);
  progress?.('Phase 3/5: Skeleton built', 50);

  // ── Phase 4: Infographics (Playwright + AntV; deterministic DSL)
  let infographicMap: Record<string, InfographicResult[]> = {};
  if (!config.skip_infographics) {
    progress?.('Phase 4/5: Generating infographic images...', 55);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw_infographics_'));
    try {
      infographicMap = await generateAllInfographics(
        skeleton, contentMap, tmp, apiKey, config.infographic_model || model,
      );
    } catch (e: any) {
      console.error('[cw-slides] infographic phase failed:', e.message);
    }
  } else {
    progress?.('Phase 4/5: Infographics skipped', 75);
  }
  const genInfographics = Object.values(infographicMap).flat().filter((r) => r.generated).length;
  const totalInfographics = Object.values(infographicMap).flat().length;
  progress?.(`Phase 4/5: Infographics — ${genInfographics}/${totalInfographics}`, 75);

  // ── Phase 5: Assembly + PPTX
  progress?.('Phase 5/5: Assembling slides and building PPTX...', 80);
  const luDataMap = assemble(skeleton, contentMap, infographicMap);
  const { buffer, slideCount } = await buildPptxBuffer(ctx, skeleton, luDataMap, company, target);
  progress?.(`Phase 5/5: PPTX built — ${slideCount} slides`, 100);

  return {
    success: true,
    message: `${slideCount} slides across ${lus.length} LUs`,
    buffer,
    slideCount,
    stats: {
      research: { topics_researched: researched, total_sources: totalSources },
      content: { total_blocks: totalBlocks, topics_with_blocks: Object.keys(contentMap).length },
      infographic: { generated: genInfographics, total: totalInfographics },
      lu_count: lus.length,
    },
  };
}
