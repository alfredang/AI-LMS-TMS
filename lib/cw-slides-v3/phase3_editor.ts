/**
 * Phase 3 — Editor Agent (TS port of Streamlit's editor_agent.py).
 *
 * Receives content blocks from Phase 2 and produces the slide-deck skeleton
 * with infographic_assignments for each topic. AI-driven (single Claude call),
 * with a deterministic fallback that builds the skeleton directly from
 * content blocks if the AI call fails.
 *
 * Critical: ALWAYS rebuilds infographic_assignments from content_map after
 * the AI returns to guarantee 1:1 mapping (the AI editor often emits fewer
 * assignments than blocks, which would orphan content slides).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import type { ContentBlock, ContentMapEntry } from './types';

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const EDITOR_MAX_TURNS = 3;

// ────────────────────────────────────────────────────────────────────────────
// Skeleton types
// ────────────────────────────────────────────────────────────────────────────

export interface InfographicAssignment {
  slide_position: number;
  content_block_index: number;
  sub_title: string;
  visualization_type: string;
  assigned_template: string;
}

export interface SkeletonTopic {
  topic_number: string;
  topic_title: string;
  num_infographic_slides: number;
  infographic_assignments: InfographicAssignment[];
  has_activity: boolean;
}

export interface SkeletonLu {
  lu_number: string;
  lu_title: string;
  topics: SkeletonTopic[];
}

export interface SkeletonLo {
  lo_number: string;
  lo_title: string;
  lo_description: string;
  learning_units: SkeletonLu[];
}

export interface StandardSlide {
  type: string;
  title: string;
}

export interface Skeleton {
  total_target_slides: number;
  course_days: number;
  standard_intro_slides: StandardSlide[];
  learning_outcomes: SkeletonLo[];
  standard_closing_slides: StandardSlide[];
}

// ────────────────────────────────────────────────────────────────────────────
// Standard slide blocks (fixed across all decks)
// ────────────────────────────────────────────────────────────────────────────

const STANDARD_INTRO_SLIDES: StandardSlide[] = [
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

const STANDARD_CLOSING_SLIDES: StandardSlide[] = [
  { type: 'section', title: 'Summary & Q&A' },
  { type: 'content', title: 'TRAQOM Survey' },
  { type: 'content', title: 'Certificate of Accomplishment' },
  { type: 'attendance', title: 'Digital Attendance' },
  { type: 'section', title: 'Final Assessment' },
  { type: 'content', title: 'Support' },
  { type: 'section', title: 'Thank You' },
];

// ────────────────────────────────────────────────────────────────────────────
// Template families per visualization_type (Streamlit-aligned)
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Editor system prompt (verbatim port of Streamlit's EDITOR_SYSTEM_PROMPT)
// ────────────────────────────────────────────────────────────────────────────

const EDITOR_SYSTEM_PROMPT = `You are an expert WSQ training slide architect and visual flow designer.

YOUR EXPERTISE:
- Singapore WSQ presentation standards and structure
- AntV Infographic template system (65+ templates)
- Visual storytelling: sequence templates for flow, variety for engagement

You design the complete deck structure by mapping content blocks to slide positions
with the BEST AntV template for each content type.

AntV TEMPLATE SELECTION:
- "overview" → list-grid-badge-card, list-grid-candy-card-lite, list-grid-ribbon-card, list-row-horizontal-icon-arrow, list-row-simple-illus, list-zigzag-down-compact-card, list-sector-plain-text, list-column-done-list
- "process" → sequence-snake-steps-compact-card, sequence-roadmap-vertical-simple, sequence-stairs-front-compact-card, sequence-stairs-front-pill-badge, sequence-mountain-underline-text, sequence-color-snake-steps-horizontal-icon-line
- "comparison" → compare-binary-horizontal-badge-card-arrow, compare-binary-horizontal-simple-fold, compare-binary-horizontal-underline-text-vs, compare-hierarchy-left-right-circle-node-pill-badge
- "cycle" → sequence-circular-simple, sequence-pyramid-simple, sequence-cylinders-3d-simple
- "hierarchy" → hierarchy-tree-curved-line-rounded-rect-node, hierarchy-tree-tech-style-badge-card, hierarchy-structure
- "statistics" → chart-bar-plain-text, chart-pie-compact-card, chart-pie-donut-plain-text, chart-line-plain-text
- "timeline" → sequence-timeline-simple, sequence-timeline-rounded-rect-node, sequence-timeline-simple-illus
- "relationship" → relation-circle-icon-badge, relation-circle-circular-progress
- "quadrant" → quadrant-quarter-simple-card, quadrant-quarter-circular

VISUAL FLOW RULES:
1. Map EVERY content block to a slide position — each block = one infographic slide
2. Validate that assigned_template matches the visualization_type
3. NEVER assign the same template to consecutive slides — ensure visual variety
4. First slide of each topic should use a list-grid-* or list-row-* (overview)
5. Statistical data → prefer chart-bar or chart-pie templates
6. Process content → prefer sequence-* templates
7. Comparison content → use compare-* templates with EXACTLY 2 items

Output ONLY valid JSON. No markdown, no explanation.`;

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
  maxTurns?: number;
  model?: string;
  apiKey: string;
}): Promise<any> {
  const { prompt, systemPrompt, maxTurns = EDITOR_MAX_TURNS, model, apiKey } = opts;
  const env = buildClaudeEnv(apiKey);
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '64000';
  const sdkOptions: any = {
    env,
    allowedTools: [],
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
  if (!parsed) throw new Error(`Editor output not valid JSON. Output: ${lastText.slice(0, 500)}`);
  return parsed;
}

// ────────────────────────────────────────────────────────────────────────────
// Fuzzy topic match (handles AI rephrasing)
// ────────────────────────────────────────────────────────────────────────────

function fuzzyGetContent<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (!map || !key) return undefined;
  if (key in map) return map[key];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[_\-]/g, '').trim();
  const nk = norm(key);
  for (const [k, v] of Object.entries(map)) if (norm(k) === nk) return v;
  const kl = key.toLowerCase().trim();
  for (const [k, v] of Object.entries(map)) {
    const kkl = k.toLowerCase().trim();
    if (kl.includes(kkl) || kkl.includes(kl)) return v;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation — ALWAYS rebuild assignments from content_map (1:1 mapping)
// ────────────────────────────────────────────────────────────────────────────

function pickTemplate(vizType: string, used: Set<string>): string {
  const family = TEMPLATE_MAP[vizType] || TEMPLATE_MAP.overview;
  for (const t of family) {
    if (!used.has(t)) {
      used.add(t);
      return t;
    }
  }
  // All used — start over but skip the most-recent
  used.clear();
  used.add(family[0]);
  return family[0];
}

function validateSkeleton(
  skeleton: Skeleton,
  contentMap: Record<string, ContentMapEntry>,
): void {
  if (!skeleton.learning_outcomes) {
    skeleton.learning_outcomes = [];
  }

  for (const lo of skeleton.learning_outcomes) {
    if (!lo.learning_units) lo.learning_units = [];
    for (const lu of lo.learning_units) {
      if (!lu.topics) lu.topics = [];
      for (const topic of lu.topics) {
        const matched = fuzzyGetContent(contentMap, topic.topic_title);
        const blocks: ContentBlock[] = matched?.content_blocks || [];
        const existing = topic.infographic_assignments || [];

        // ALWAYS rebuild assignments to guarantee 1:1 mapping with blocks.
        // The AI editor often emits fewer assignments than blocks exist —
        // that orphans content. Rebuild from blocks, preserving any AI
        // template choices that line up with block indexes.
        if (blocks.length > 0) {
          const usedTemplates = new Set<string>();
          const newAssignments: InfographicAssignment[] = [];
          for (let bi = 0; bi < blocks.length; bi++) {
            const block = blocks[bi];
            const aiAssignment = existing.find((a) => a.content_block_index === bi);
            const vizType = String(block.visualization_type || 'overview');
            const aiTemplate = aiAssignment?.assigned_template;
            const aiTemplateValid = aiTemplate && (TEMPLATE_MAP[vizType] || []).includes(aiTemplate);
            const template = aiTemplateValid
              ? aiTemplate!
              : (block.suggested_template && (TEMPLATE_MAP[vizType] || []).includes(block.suggested_template))
                ? block.suggested_template
                : pickTemplate(vizType, usedTemplates);
            usedTemplates.add(template);
            newAssignments.push({
              slide_position: bi,
              content_block_index: bi,
              sub_title: String(block.sub_title || `Slide ${bi + 1}`),
              visualization_type: vizType,
              assigned_template: template,
            });
          }
          topic.infographic_assignments = newAssignments;
          topic.num_infographic_slides = newAssignments.length;
        } else {
          topic.infographic_assignments = existing;
          topic.num_infographic_slides = existing.length;
        }
        topic.has_activity = topic.has_activity ?? true;
      }
    }
  }

  // Always ensure standard intro/closing slides are present
  if (!skeleton.standard_intro_slides || skeleton.standard_intro_slides.length === 0) {
    skeleton.standard_intro_slides = STANDARD_INTRO_SLIDES;
  }
  if (!skeleton.standard_closing_slides || skeleton.standard_closing_slides.length === 0) {
    skeleton.standard_closing_slides = STANDARD_CLOSING_SLIDES;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic fallback skeleton — used when AI editor fails
// ────────────────────────────────────────────────────────────────────────────

function fallbackSkeleton(
  context: any,
  totalHours: number,
  contentMap: Record<string, ContentMapEntry>,
): Skeleton {
  const courseTitle = String(context.Course_Title || 'Course');
  const lus = Array.isArray(context.Learning_Units) ? context.Learning_Units : [];
  const courseDays = Math.max(1, Math.round(totalHours / 8));

  const learningOutcomes: SkeletonLo[] = [];
  for (let li = 0; li < lus.length; li++) {
    const lu = lus[li];
    const luNum = String(lu.LU_Number || `LU${li + 1}`);
    const loNum = String(lu.LO_Number || `LO${li + 1}`);
    const luTitle = String(lu.LU_Title || '');
    const loDesc = String(lu.LO || lu.LO_Description || '');
    const topics = Array.isArray(lu.Topics) ? lu.Topics : [];

    const topicEntries: SkeletonTopic[] = [];
    for (let ti = 0; ti < topics.length; ti++) {
      const t = topics[ti];
      const tTitle = String(t.Topic_Title || `Topic ${ti + 1}`);
      const matched = fuzzyGetContent(contentMap, tTitle);
      const blocks: ContentBlock[] = matched?.content_blocks || [];

      const usedTemplates = new Set<string>();
      const assignments: InfographicAssignment[] = [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        const vizType = String(block.visualization_type || 'overview');
        const template = (block.suggested_template && (TEMPLATE_MAP[vizType] || []).includes(block.suggested_template))
          ? block.suggested_template
          : pickTemplate(vizType, usedTemplates);
        usedTemplates.add(template);
        assignments.push({
          slide_position: bi,
          content_block_index: bi,
          sub_title: String(block.sub_title || `Slide ${bi + 1}`),
          visualization_type: vizType,
          assigned_template: template,
        });
      }
      topicEntries.push({
        topic_number: `T${ti + 1}`,
        topic_title: tTitle,
        num_infographic_slides: assignments.length,
        infographic_assignments: assignments,
        has_activity: true,
      });
    }

    let lo = learningOutcomes.find((x) => x.lo_number === loNum);
    const luEntry: SkeletonLu = {
      lu_number: luNum,
      lu_title: luTitle,
      topics: topicEntries,
    };
    if (lo) {
      lo.learning_units.push(luEntry);
    } else {
      learningOutcomes.push({
        lo_number: loNum,
        lo_title: loDesc,
        lo_description: loDesc,
        learning_units: [luEntry],
      });
    }
  }

  const totalAssignments = learningOutcomes
    .flatMap((lo) => lo.learning_units)
    .flatMap((lu) => lu.topics)
    .reduce((n, t) => n + t.num_infographic_slides, 0);

  return {
    total_target_slides: totalAssignments + 17 + lus.length * 2,
    course_days: courseDays,
    standard_intro_slides: [
      ...STANDARD_INTRO_SLIDES.slice(0, 1).map((s) => ({ ...s, title: courseTitle })),
      ...STANDARD_INTRO_SLIDES.slice(1),
    ],
    learning_outcomes: learningOutcomes,
    standard_closing_slides: STANDARD_CLOSING_SLIDES,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public — buildSkeleton
// ────────────────────────────────────────────────────────────────────────────

export async function buildSkeleton(
  context: any,
  contentMap: Record<string, ContentMapEntry>,
  apiKey: string,
  model?: string,
): Promise<Skeleton> {
  const courseTitle = String(context.Course_Title || 'Course');
  const tgsRef = String(context.TGS_Ref_No || '');
  const totalHoursRaw = String(context.Total_Training_Hours || context.Total_Course_Duration_Hours || '16');
  const totalHours = parseFloat(totalHoursRaw.replace(/[^\d.]/g, '')) || 16;
  const courseDays = Math.max(1, totalHours / 8);

  const lus = Array.isArray(context.Learning_Units) ? context.Learning_Units : [];
  const totalTopics = lus.reduce((n: number, lu: any) => n + (Array.isArray(lu.Topics) ? lu.Topics.length : 0), 0) || 1;

  // Build LU/Topic summary with content block info
  const luSummaryParts: string[] = [];
  for (const lu of lus) {
    const luNum = String(lu.LU_Number || 'LU?');
    const luTitle = String(lu.LU_Title || '');
    const loNum = String(lu.LO_Number || 'LO?');
    const loDesc = String(lu.LO || '');
    const topics = Array.isArray(lu.Topics) ? lu.Topics : [];

    let part = `\n${loNum}: ${loDesc}\n  ${luNum}: ${luTitle}\n  Topics (${topics.length}):`;
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      const tTitle = String(t.Topic_Title || `Topic ${i + 1}`);
      part += `\n    T${i + 1}: ${tTitle}`;
      const matched = fuzzyGetContent(contentMap, tTitle);
      const blocks = matched?.content_blocks || [];
      if (blocks.length > 0) {
        part += ` — ${blocks.length} content blocks:`;
        for (let bi = 0; bi < blocks.length; bi++) {
          const b = blocks[bi];
          part += `\n      Block ${bi}: [${b.visualization_type}] ${b.sub_title} → ${b.suggested_template || '?'}`;
        }
      }
    }
    luSummaryParts.push(part);
  }

  const prompt = `Create the slide deck skeleton with infographic assignments for this WSQ course.

COURSE INFO:
- Title: ${courseTitle}
- TGS Reference: ${tgsRef}
- Total Training Hours: ${totalHours} hours (${courseDays.toFixed(0)} day(s))
- Total Topics: ${totalTopics}

LEARNING UNITS, TOPICS & CONTENT BLOCKS:${luSummaryParts.join('\n')}

INSTRUCTIONS:
1. Include ALL standard WSQ opening (10) and closing (7) slides
2. For each topic, map content blocks to infographic slide positions (1:1)
3. Validate template choices — ensure assigned_template matches visualization_type
4. Override suggested_template if a better one exists for the content
5. Ensure template variety — no consecutive duplicate templates within a topic

Return ONLY this JSON structure (no markdown):
{
  "total_target_slides": <number>,
  "course_days": ${courseDays.toFixed(0)},
  "standard_intro_slides": [
    {"type": "cover", "title": "${courseTitle}"},
    {"type": "attendance", "title": "Digital Attendance (Mandatory)"},
    {"type": "placeholder", "title": "About the Trainer"},
    {"type": "icebreaker", "title": "Let's Know Each Other"},
    {"type": "content", "title": "Ground Rules"},
    {"type": "content", "title": "Skills Framework"},
    {"type": "content", "title": "Knowledge & Ability Statements"},
    {"type": "content", "title": "Course Outline"},
    {"type": "content", "title": "Assessment Methods & Briefing"},
    {"type": "content", "title": "Criteria for Funding"}
  ],
  "learning_outcomes": [
    {
      "lo_number": "LO1",
      "lo_title": "...",
      "lo_description": "...",
      "learning_units": [
        {
          "lu_number": "LU1",
          "lu_title": "...",
          "topics": [
            {
              "topic_number": "T1",
              "topic_title": "<EXACT input topic title — no rephrasing>",
              "num_infographic_slides": <count>,
              "infographic_assignments": [
                {
                  "slide_position": 0,
                  "content_block_index": 0,
                  "sub_title": "<from content block>",
                  "visualization_type": "<from content block>",
                  "assigned_template": "<valid AntV template name from the family for this viz_type>"
                }
              ],
              "has_activity": true
            }
          ]
        }
      ]
    }
  ],
  "standard_closing_slides": [
    {"type": "section", "title": "Summary & Q&A"},
    {"type": "content", "title": "TRAQOM Survey"},
    {"type": "content", "title": "Certificate of Accomplishment"},
    {"type": "attendance", "title": "Digital Attendance"},
    {"type": "section", "title": "Final Assessment"},
    {"type": "content", "title": "Support"},
    {"type": "section", "title": "Thank You"}
  ]
}

CRITICAL:
- topic_title MUST be EXACTLY the input topic title (no rephrasing)
- lu_number / lo_number must match input EXACTLY
- ONE infographic_assignment per content block (1:1)
- assigned_template must be valid for the viz_type's family
- Vary templates across consecutive slides`;

  try {
    const result = await runAgentJson({
      prompt,
      systemPrompt: EDITOR_SYSTEM_PROMPT,
      maxTurns: EDITOR_MAX_TURNS,
      model: model || FAST_MODEL,
      apiKey,
    });
    const skeleton = result as Skeleton;
    validateSkeleton(skeleton, contentMap);
    const totalAssignments = skeleton.learning_outcomes
      .flatMap((lo) => lo.learning_units)
      .flatMap((lu) => lu.topics)
      .reduce((n, t) => n + t.num_infographic_slides, 0);
    console.log(`[cw-slides-v3] editor skeleton built: ${totalAssignments} infographic assignments across ${skeleton.learning_outcomes.length} LOs`);
    return skeleton;
  } catch (e: any) {
    console.warn(`[cw-slides-v3] editor agent failed (${e.message?.slice(0, 200)}); using deterministic fallback skeleton`);
    return fallbackSkeleton(context, totalHours, contentMap);
  }
}
