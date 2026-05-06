/**
 * Course-duration parsing and slide-target math.
 *
 * Mirrors Streamlit `multi_agent_config.py` SLIDE_TARGETS,
 * compute_total_target, compute_per_topic_distribution.
 *
 * Slide-count targets (auto-detection only, no manual override).
 * Per user spec for v3:
 *   1-day (8h)  → 100 slides
 *   2-day (16h) → 140 slides   (was 160 in v2; updated per user)
 *   3-day (24h) → 210 slides
 *   4-day (32h) → 250 slides
 *   5-day (40h) → 320 slides   (extrapolated; user spec stops at 4-day)
 *
 * Auto-detection cascade for hours:
 *   1. Try every Total_*_Hours / Total_*_Duration field on courseData
 *      (PascalCase + camelCase variants)
 *   2. Scan the raw CP text for "Total <X> Duration | N hour" patterns
 *   3. If still nothing, fall back to topic-count × 2 hours
 *   4. Floor at 8h
 *
 * Always picks the LARGEST plausible value across all sources, so a single
 * stale or empty field can't drag the deck size down to 1-day target.
 */

// ────────────────────────────────────────────────────────────────────────────
// Slide-target tables
// ────────────────────────────────────────────────────────────────────────────

// Tuples are [min, target]. Target is what computeTotalTarget returns.
// Targets per user spec (2026-05-06):
//   1-day (8h)  → 100, 2-day (16h) → 160, 3-day (24h) → 210,
//   4-day (32h) → 250, 5-day (40h) → 320
export const SLIDE_TARGETS: Record<number, [number, number]> = {
  1: [60, 100],
  2: [140, 160],
  3: [195, 210],
  4: [230, 250],
  5: [290, 320],
};

const SLIDES_PER_DAY_DEFAULT = 70;
// Lowered from 6 → 2 so per-topic budget can be distributed across many
// sub-topics without overshooting the duration target. With sub-topics
// kept intact (orchestrator.ts smart-collapse logic), a 4-day course with
// 20 sub-topics now gets ~10 blocks each instead of being forced to
// collapse to 4 LUs × 30 capped blocks + huge text-padding fill.
export const MIN_BLOCKS_PER_TOPIC = 2;
export const MAX_SLIDES_PER_TOPIC = 30;

// ────────────────────────────────────────────────────────────────────────────
// Hour-string parsing
// ────────────────────────────────────────────────────────────────────────────

/** Parse a duration string into hours. Handles many formats:
 *    "32 hours", "32 hr", "30 hours 30 minutes", "32 hour 0 minutes",
 *    "4 days", "4-day", "32" (assumed hours).
 */
export function parseHours(raw: unknown): number {
  let s = String(raw ?? '').toLowerCase().trim();
  if (!s || ['n/a', 'na', 'nil', 'none', '-'].includes(s)) return 0;

  // Days first — convert to hours
  const dayMatch = s.match(/(\d+(?:\.\d+)?)\s*day/);
  if (dayMatch) {
    const d = parseFloat(dayMatch[1]);
    if (Number.isFinite(d) && d >= 0.5 && d <= 60) return d * 8;
  }

  // "X hour Y minute" style
  const hmMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|h)s?\s*(\d+)\s*(?:minute|min)/);
  if (hmMatch) {
    const h = parseFloat(hmMatch[1]);
    const m = parseFloat(hmMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) return h + m / 60;
  }

  // Strip unit suffixes and parse the leading number
  s = s.replace(/hours/g, '').replace(/hrs/g, '').replace(/hr/g, '').replace(/h\b/g, '').trim();
  const m = s.match(/[\d.]+/);
  const n = m ? parseFloat(m[0]) : 0;
  return Number.isFinite(n) ? n : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Last-resort text scan — finds duration anywhere in CP text
// ────────────────────────────────────────────────────────────────────────────

/** Scan parsed CP text for the LARGEST plausible total course/training/
 *  instructional duration. Handles legacy ("Total Duration | 24 hours") AND
 *  new SSG WSQ form ("Total Course Duration | 32 hour 0 minutes") formats.
 */
export function extractDurationHoursFromText(cpText: string): number {
  if (!cpText) return 0;
  const text = cpText;
  const candidates: number[] = [];

  // 1. "Total <Course|Training|Instructional> Duration | N hour [M minute]"
  const totalDurRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Duration\s*[:\|]\s*([\d.]+)\s*(?:hour|hr)s?\s*(?:([\d.]+)\s*(?:minute|min)s?)?/gi;
  for (const m of text.matchAll(totalDurRe)) {
    const h = parseFloat(m[1]);
    const min = m[2] ? parseFloat(m[2]) : 0;
    if (Number.isFinite(h) && h >= 1) candidates.push(h + min / 60);
  }

  // 2. "Total <Course|Training|Instructional> Hours: N"
  const totalHrsRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Hours?\s*[:\|]\s*([\d.]+)/gi;
  for (const m of text.matchAll(totalHrsRe)) {
    const h = parseFloat(m[1]);
    if (Number.isFinite(h) && h >= 1) candidates.push(h);
  }

  // 3. "Total Duration | 4 day"
  const totalDaysRe = /Total\s+(?:Course\s+|Training\s+|Instructional\s+)?Duration\s*[:\|]\s*([\d.]+)\s*day/gi;
  for (const m of text.matchAll(totalDaysRe)) {
    const d = parseFloat(m[1]);
    if (Number.isFinite(d) && d >= 1) candidates.push(d * 8);
  }

  // 4. "X-day course" / "X day training"
  const ndayRe = /(\d+(?:\.\d+)?)\s*[-]?\s*day\s+(?:course|training|programme|program|workshop)/gi;
  for (const m of text.matchAll(ndayRe)) {
    const d = parseFloat(m[1]);
    if (Number.isFinite(d) && d >= 1 && d <= 30) candidates.push(d * 8);
  }

  // 5. Loose "X hours" near a duration context word
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
  return Math.max(...candidates);
}

// ────────────────────────────────────────────────────────────────────────────
// Resolve duration from courseData context — orchestrator entry point
// ────────────────────────────────────────────────────────────────────────────

export interface DurationResult {
  hours: number;
  resolvedFrom: string;
  candidates: Array<{ value: number; source: string }>;
}

/** Try every duration source and return the LARGEST valid value. */
export function resolveDuration(ctx: any, totalTopics: number): DurationResult {
  const candidateFields = [
    { v: ctx.Total_Course_Duration_Hours, k: 'Total_Course_Duration_Hours' },
    { v: ctx.Total_Course_Duration, k: 'Total_Course_Duration' },
    { v: ctx.Total_Training_Hours, k: 'Total_Training_Hours' },
    { v: ctx.Total_Training_Duration, k: 'Total_Training_Duration' },
    { v: ctx.Total_Instructional_Duration, k: 'Total_Instructional_Duration' },
    { v: ctx.totalTrainingHours, k: 'totalTrainingHours' },
    { v: ctx.totalCourseDuration, k: 'totalCourseDuration' },
  ];

  const candidates: Array<{ value: number; source: string }> = [];
  for (const f of candidateFields) {
    const h = parseHours(f.v);
    if (h >= 1) candidates.push({ value: h, source: `field='${f.k}=${f.v}'` });
  }

  const cpText = String(ctx._cp_text ?? '');
  const fromText = extractDurationHoursFromText(cpText);
  if (fromText >= 1) candidates.push({ value: fromText, source: `cp-text scan` });

  let hours = 0;
  let resolvedFrom = 'none (defaulted to 8h floor)';
  for (const c of candidates) {
    if (c.value > hours) {
      hours = c.value;
      resolvedFrom = c.source;
    }
  }

  if (hours < 1 && totalTopics > 0) {
    hours = Math.max(8, totalTopics * 2);
    resolvedFrom = `topic-count heuristic (${totalTopics} topics × 2)`;
  }
  if (hours < 8) hours = 8;

  return { hours, resolvedFrom, candidates };
}

// ────────────────────────────────────────────────────────────────────────────
// Slide-count math
// ────────────────────────────────────────────────────────────────────────────

/** Standard (non-content) slide count: 10 intro + 7 closing + 2 per topic
 *  (LO header + activity slide). */
export function computeStandardSlideCount(numTopics: number): number {
  return 17 + numTopics * 2;
}

/** Convert hours → days → target slide count. Streamlit-equivalent. */
export function computeTotalTarget(hours: number): number {
  const days = Math.max(1, Math.round(hours / 8));
  if (SLIDE_TARGETS[days]) return SLIDE_TARGETS[days][1];
  const baseMax = SLIDE_TARGETS[2][1];
  return baseMax + (days - 2) * SLIDES_PER_DAY_DEFAULT;
}

/** Distribute content blocks evenly across topics so the deck hits target. */
export function computePerTopicDistribution(hours: number, numTopics: number): number[] {
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
