/**
 * v2 Orchestrator — 5-phase pipeline.
 *
 * Phase 1 (Research) and Phase 2 (Content) are clean rewrites with
 * Streamlit-faithful prompts and always-pad-to-target.
 *
 * Phases 3-5 reuse v1's existing implementation (which has the working
 * AntV+Playwright PNG renderer and the WSQ-templated PPTX builders).
 * v2 adds export keywords to those v1 functions to enable reuse.
 *
 * Single-source-of-truth for slide-count math is in `./duration.ts`,
 * matching Streamlit's `multi_agent_config.py` exactly.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateAllInfographicsImpl } from '../cw-slides-infographic';
import {
  buildSkeleton,
  assemble,
  makePres,
  addIntroSlides,
  addLuSlides,
  addClosingSlides,
  buildPptxBuffer,
  scrubPptxBuffer,
  normaliseContext,
} from '../cw-slides';
import { researchAllTopics } from './phase1_research';
import { generateAllContent } from './phase2_content';
import { computeTotalTarget, computePerTopicDistribution, resolveDuration } from './duration';
import type {
  CwCompanyInfo,
  SlideAgentConfig,
  SlideTopic,
  SlidesResult,
  ContentMapEntry,
  ResearchEntry,
  Skeleton,
  InfographicResult,
} from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ────────────────────────────────────────────────────────────────────────────
// Public entry — same signature as v1 generateSlides for drop-in replacement
// ────────────────────────────────────────────────────────────────────────────

export async function generateSlides(
  contextIn: any,
  apiKey: string,
  config: SlideAgentConfig = {},
  progress?: (msg: string, pct: number) => void,
): Promise<SlidesResult> {
  const ctx = normaliseContext(contextIn);
  const model = config.model || DEFAULT_MODEL;
  const company = config.company;

  const courseTitle = String(ctx.Course_Title || 'Course');
  const lus = Array.isArray(ctx.Learning_Units) ? ctx.Learning_Units : [];
  const totalTopics = lus.reduce((n: number, lu: any) => n + (Array.isArray(lu.Topics) ? lu.Topics.length : 0), 0);

  // Auto-detect duration → slide-count math
  const dur = resolveDuration(ctx, totalTopics);
  const target = computeTotalTarget(dur.hours);
  const perTopic = computePerTopicDistribution(dur.hours, Math.max(1, totalTopics));
  console.log(`[cw-slides-v2] DURATION: ${dur.hours}h from ${dur.resolvedFrom} → target=${target} slides (${totalTopics} topics, ${perTopic[0] ?? 0} blocks/topic)`);

  // Flatten topics for per-topic phases
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

  // ── Phase 1: Research ────────────────────────────────────────────────
  progress?.(`Phase 1/5: Researching ${allTopics.length} topics...`, 5);
  const researchMap: Record<string, ResearchEntry> = allTopics.length
    ? await researchAllTopics(allTopics, courseTitle, apiKey, model)
    : {};
  const researched = Object.values(researchMap).filter((r) => (r.sources || []).length > 0).length;
  const totalSources = Object.values(researchMap).reduce((n, r) => n + (r.sources?.length || 0), 0);
  progress?.(`Phase 1/5: Research complete — ${researched}/${allTopics.length} topics, ${totalSources} sources`, 20);

  // ── Phase 2: Content blocks ──────────────────────────────────────────
  progress?.('Phase 2/5: Generating content blocks...', 25);
  const contentMap: Record<string, ContentMapEntry> = allTopics.length
    ? await generateAllContent(allTopics, researchMap, perTopic, courseTitle, apiKey, model)
    : {};
  const totalBlocks = Object.values(contentMap).reduce((n, c) => n + c.content_blocks.length, 0);
  progress?.(`Phase 2/5: Content blocks — ${totalBlocks} blocks across ${Object.keys(contentMap).length} topics`, 40);

  // ── Phase 3: Skeleton (reuse v1) ─────────────────────────────────────
  progress?.('Phase 3/5: Building deck skeleton...', 45);
  const skeleton = buildSkeleton(ctx, contentMap as any) as unknown as Skeleton;
  progress?.('Phase 3/5: Skeleton built', 50);

  // ── Phase 4: Infographic PNGs (reuse existing impl) ──────────────────
  let infographicMap: Record<string, InfographicResult[]> = {};
  if (!config.skip_infographics) {
    progress?.('Phase 4/5: Generating infographic images...', 55);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw_v2_infographics_'));
    try {
      const raw = await generateAllInfographicsImpl(
        skeleton as any,
        contentMap as any,
        tmp,
      );
      for (const [k, v] of Object.entries(raw)) {
        infographicMap[k] = (v as any[]).map((r) => ({
          topic_title: r.topic,
          slide_position: r.slide_position,
          sub_title: r.sub_title || '',
          image_path: r.image_path ?? null,
          caption: r.caption || '',
          generated: !!r.generated,
          error: r.error,
        }));
      }
    } catch (e: any) {
      console.error('[cw-slides-v2] infographic phase failed:', e.message);
    }
  } else {
    progress?.('Phase 4/5: Infographics skipped', 75);
  }
  const genInfographics = Object.values(infographicMap).flat().filter((r) => r.generated).length;
  const totalInfographics = Object.values(infographicMap).flat().length;
  progress?.(`Phase 4/5: Infographics — ${genInfographics}/${totalInfographics}`, 75);

  // ── Phase 5: Assembly + PPTX (reuse v1) ──────────────────────────────
  progress?.('Phase 5/5: Assembling slides and building PPTX...', 80);
  const luDataMap = assemble(skeleton as any, contentMap as any, infographicMap as any);
  const { buffer, slideCount } = await buildPptxBuffer(ctx, skeleton as any, luDataMap, company, target);
  progress?.(`Phase 5/5: PPTX built — ${slideCount} slides`, 100);

  return {
    success: true,
    message: `${slideCount} slides across ${lus.length} LUs`,
    buffer: scrubPptxBuffer(buffer),
    slideCount,
    stats: {
      research: { topics_researched: researched, total_sources: totalSources },
      content: { total_blocks: totalBlocks, topics_with_blocks: Object.keys(contentMap).length },
      infographic: { generated: genInfographics, total: totalInfographics },
      lu_count: lus.length,
    },
  };
}

// Re-export shared types so the API endpoint can swap imports cleanly
export type { CwCompanyInfo, SlideAgentConfig, SlideTopic, SlidesResult } from './types';
