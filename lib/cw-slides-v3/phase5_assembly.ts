/**
 * Phase 5 — Assembly (TS port of Streamlit's assemble_final_slides).
 *
 * Pure logic, no LLM. Maps each infographic PNG to its slide position via
 * the skeleton, fuzzy-matches topic titles to handle AI rephrasing, and
 * produces the LuDataMap consumed by the PPTX builder.
 *
 * Drops content blocks where the PNG render failed (no text-bullet
 * fallback per user rule #4).
 */

import type { ContentBlock, ContentMapEntry, ActivityData } from './types';
import type { Skeleton, InfographicAssignment, SkeletonTopic } from './phase3_editor';

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 result type (matches phase4_infographic.ts InfographicResult)
// ────────────────────────────────────────────────────────────────────────────

export interface InfographicResult {
  topic: string;
  slide_position: number;
  sub_title: string;
  visualization_type: string;
  template_used: string;
  html_path?: string;
  image_path?: string | null;
  caption: string;
  generated: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// LuDataMap — what the PPTX builder consumes
// ────────────────────────────────────────────────────────────────────────────

export interface AssemblyTopicSlide {
  position: number;
  title: string;
  image_path: string | null;
  caption: string;
  fallback_bullets: string[]; // unused for content slides (rule #4) but kept for compat
}

export interface AssemblyTopic {
  title: string;
  topic_number: string;
  lo_number: string;
  lo_title: string;
  lu_number: string;
  lu_title: string;
  infographic_slides: AssemblyTopicSlide[];
  activity?: string[];
}

export interface LuDataMap {
  [lu_number: string]: { topics: AssemblyTopic[] };
}

// ────────────────────────────────────────────────────────────────────────────
// Fuzzy topic-title match (handles AI rephrasing)
// ────────────────────────────────────────────────────────────────────────────

function fuzzyGet<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (!map || !key) return undefined;
  if (key in map) return map[key];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.,;:!?()"']/g, '');
  const nk = norm(key);
  if (!nk) return undefined;
  for (const [k, v] of Object.entries(map)) if (norm(k) === nk) return v;
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Activity formatting (turn ActivityData into the line-array the PPTX expects)
// ────────────────────────────────────────────────────────────────────────────

function formatActivity(activity: ActivityData | undefined): string[] {
  if (!activity) return [];
  const lines: string[] = [];
  if (activity.title) lines.push(`Activity: ${activity.title}`);
  if (activity.scenario) lines.push(`Scenario: ${activity.scenario}`);
  for (const step of activity.steps || []) lines.push(step);
  if (activity.expected_output) lines.push(`Expected Output: ${activity.expected_output}`);
  if (activity.duration) lines.push(`Duration: ${activity.duration}`);
  return lines;
}

// ────────────────────────────────────────────────────────────────────────────
// Quality gate — drop blocks with no real content
// ────────────────────────────────────────────────────────────────────────────

function isBlockThin(block: ContentBlock | undefined): boolean {
  if (!block) return true;
  const items = block.data?.items || [];
  if (items.length === 0) return true;
  const meaningful = items.filter((it) =>
    String(it.label ?? '').trim().length >= 3 &&
    (String(it.desc ?? '').trim().length >= 3 || typeof it.value === 'number')
  );
  return meaningful.length === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Public — assemble LuDataMap from skeleton + content + infographics
// ────────────────────────────────────────────────────────────────────────────

export function assembleLuData(
  skeleton: Skeleton,
  contentMap: Record<string, ContentMapEntry>,
  infographicMap: Record<string, InfographicResult[]>,
): LuDataMap {
  const luMap: LuDataMap = {};

  for (const lo of skeleton.learning_outcomes || []) {
    for (const lu of lo.learning_units || []) {
      const topics: AssemblyTopic[] = [];

      for (const t of lu.topics || []) {
        const tTitle = t.topic_title;
        const matched = fuzzyGet(contentMap, tTitle);
        const blocks: ContentBlock[] = matched?.content_blocks || [];
        const activityLines = formatActivity(matched?.activity);
        const infos = fuzzyGet(infographicMap, tTitle) || [];

        const infographicSlides: AssemblyTopicSlide[] = [];
        for (const a of t.infographic_assignments || []) {
          const block = blocks[a.content_block_index];
          if (isBlockThin(block)) continue; // drop empty blocks

          const info = infos.find((i) => i.slide_position === a.slide_position);
          const hasImage = !!info?.generated && !!info.image_path;

          // Per user rule #4: NEVER fall back to text-bullet. If PNG
          // didn't render, drop the slide entirely.
          if (!hasImage) continue;

          infographicSlides.push({
            position: a.slide_position,
            title: a.sub_title,
            image_path: info!.image_path!,
            caption: block?.caption || '',
            fallback_bullets: [], // unused; kept on type for compat with v1 builder
          });
        }

        topics.push({
          title: tTitle,
          topic_number: t.topic_number,
          lo_number: lo.lo_number,
          lo_title: lo.lo_title,
          lu_number: lu.lu_number,
          lu_title: lu.lu_title,
          infographic_slides: infographicSlides,
          activity: activityLines,
        });
      }

      luMap[lu.lu_number] = { topics };
    }
  }

  return luMap;
}
