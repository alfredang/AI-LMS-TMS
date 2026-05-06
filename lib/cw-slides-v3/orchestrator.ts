/**
 * v3 Orchestrator — fresh 5-phase Streamlit-faithful pipeline.
 *
 * Phases (per user spec):
 *   1. Research       — single Claude+WebSearch call per topic, parallel 5
 *   2. Content        — single Claude call per topic, parallel 5; deterministic
 *                       JSON blocks (no AI DSL); pad from CP bullets, never
 *                       Wikipedia sentences
 *   3. Editor         — AI-driven skeleton; deterministic fallback if AI fails
 *   4. Infographic    — AntV+Playwright PNG render; 3 retries (5s/8s/12s);
 *                       browser restart between topics; PNG ≥ 10KB validation
 *   5. Assembly+PPTX  — pure-TS assembly; v1 WSQ slide layouts; scrubPptxBuffer
 *
 * Drop-in replacement for v1/v2 — same `generateSlides(context, apiKey, …)`
 * signature.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from '../anthropic-auth';
import { researchAllTopics } from './phase1_research';
import { generateAllContent } from './phase2_content';
import { buildSkeleton } from './phase3_editor';
import { generateAllInfographics } from './phase4_infographic';
import { assembleLuData } from './phase5_assembly';
import { buildPptxBuffer, scrubPptxBuffer, normaliseContext } from './pptx_builder';
import {
  resolveDuration,
  computeTotalTarget,
  computePerTopicDistribution,
} from './duration';
import type {
  CwCompanyInfo,
  SlideAgentConfig,
  SlideTopic,
  SlidesResult,
  ContentMapEntry,
  ResearchEntry,
} from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export async function generateSlides(
  contextIn: any,
  apiKey: string,
  config: SlideAgentConfig = {},
  progress?: (msg: string, pct: number) => void,
): Promise<SlidesResult> {
  const ctx = normaliseContext(contextIn);
  const model = config.model || DEFAULT_MODEL;
  const company = config.company;

  // Diagnostic header — visible in production Coolify logs so we can
  // trace which token type is in use and confirm cli.js is bundled.
  const tokenType = apiKey?.startsWith('sk-ant-oat') ? 'subscription (CLAUDE_CODE_OAUTH_TOKEN)'
                  : apiKey?.startsWith('sk-ant-api') ? 'API key (ANTHROPIC_API_KEY)'
                  : `unknown prefix (${apiKey?.slice(0, 12)}...)`;
  console.log(`[cw-slides-v3] BEGIN — model=${model}, token=${tokenType}, NODE_ENV=${process.env.NODE_ENV}`);

  // ── Pre-flight Claude ping ──────────────────────────────────────────
  // Tiny single-shot call before launching expensive phases. If auth
  // is broken in the production container (token expired, CLI binary
  // missing, network egress blocked), we surface that error in the
  // first 5 seconds — instead of after Phase 1 burns 4+ min and Phase
  // 2 silently falls back across all topics.
  try {
    const env = buildClaudeEnv(apiKey);
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '500';
    const sdkOptions: any = {
      env,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      maxTurns: 1,
      model: 'claude-haiku-4-5-20251001',
    };
    let pingText = '';
    for await (const message of query({
      prompt: 'Reply with exactly the JSON: {"ok":true}',
      options: sdkOptions,
    })) {
      if (message.type === 'assistant' && (message as any).message?.content) {
        for (const b of (message as any).message.content) {
          if (b.type === 'text' && b.text) pingText = b.text;
        }
      } else if (message.type === 'result' && (message as any).result) {
        pingText = (message as any).result;
      }
    }
    const pingOk = /\{[^}]*"ok"\s*:\s*true[^}]*\}/.test(pingText);
    console.log(`[cw-slides-v3] PRE-FLIGHT: Claude ping ${pingOk ? 'OK' : 'BAD'} (response: ${pingText.slice(0, 120).replace(/\n/g, ' ')})`);
    if (!pingOk) {
      console.warn(`[cw-slides-v3] PRE-FLIGHT WARNING: Claude is not responding correctly. All Phase 2/3 calls will likely fall back. Check token, network, and CLI binary in container.`);
    }
  } catch (e: any) {
    console.error(
      `[cw-slides-v3] PRE-FLIGHT FAILED — Claude unreachable: ${e?.message || String(e)} | code=${e?.code || '?'} | name=${e?.name || '?'}. ` +
      `All Phase 2/3 calls will fall back to deterministic content. Investigate auth/network/CLI binary.`,
    );
  }

  const courseTitle = String(ctx.Course_Title || 'Course');
  const lus = Array.isArray(ctx.Learning_Units) ? ctx.Learning_Units : [];

  // ── Collapse CP sub-topics into ONE topic per LU ────────────────────
  // Streamlit reference deck (100 slides for 8h) treats each LU as a
  // single topic with ~25 content blocks covering all sub-topic bullets.
  // Without this collapse, a CP with 19 sub-topics × min 6 blocks each
  // produces 114+ content slides — overshooting the 100-slide target by
  // 73 slides regardless of duration math (deck Gemini-1: 173 slides).
  // The collapse mutates ctx.Learning_Units in place so buildSkeleton
  // and assemble see the collapsed shape too.
  let consolidatedSubTopicCount = 0;
  for (const lu of lus) {
    const subTopics = Array.isArray(lu.Topics) ? lu.Topics : [];
    if (subTopics.length <= 1) continue; // already 1 topic per LU
    consolidatedSubTopicCount += subTopics.length;
    // Aggregate bullets, tagging sub-topic headings inline so Phase 2
    // can structure blocks around the original CP sub-topics.
    const aggregated: string[] = [];
    for (const st of subTopics) {
      const stTitle = String(st.Topic_Title || '').trim();
      if (stTitle) aggregated.push(`[${stTitle}]`);
      for (const bp of (Array.isArray(st.Bullet_Points) ? st.Bullet_Points : [])) {
        const t = String(bp ?? '').trim();
        if (t) aggregated.push(t);
      }
    }
    lu.Topics = [{
      Topic_Title: String(lu.LU_Title || lu.LU_Number || 'Topic'),
      Bullet_Points: aggregated,
    }];
  }
  if (consolidatedSubTopicCount > 0) {
    console.log(`[cw-slides-v3] COLLAPSED ${consolidatedSubTopicCount} CP sub-topics into ${lus.length} LU-level topics`);
  }

  const totalTopics = lus.reduce(
    (n: number, lu: any) => n + (Array.isArray(lu.Topics) ? lu.Topics.length : 0),
    0,
  );

  // Pre-processing: duration → slide target → per-topic block budget
  const dur = resolveDuration(ctx, totalTopics);
  const target = computeTotalTarget(dur.hours);
  const perTopic = computePerTopicDistribution(dur.hours, Math.max(1, totalTopics));
  console.log(
    `[cw-slides-v3] DURATION: ${dur.hours}h from ${dur.resolvedFrom} → target=${target} slides ` +
    `(${totalTopics} topics, ${perTopic[0] ?? 0} blocks/topic)`,
  );

  // Flatten topics for per-topic phases (each LU now has exactly 1 topic
  // after the collapse above, so this is one entry per LU).
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

  // ── Phase 1: Research ──────────────────────────────────────────────
  progress?.(`Phase 1/5: Researching ${allTopics.length} topics...`, 5);
  const researchMap: Record<string, ResearchEntry> = allTopics.length
    ? await researchAllTopics(allTopics, courseTitle, apiKey, model)
    : {};
  const researched = Object.values(researchMap).filter((r) => (r.sources || []).length > 0).length;
  const totalSources = Object.values(researchMap).reduce(
    (n, r) => n + (r.sources?.length || 0),
    0,
  );
  progress?.(
    `Phase 1/5: Research complete — ${researched}/${allTopics.length} topics, ${totalSources} sources`,
    20,
  );

  // ── Phase 2: Content blocks ─────────────────────────────────────────
  progress?.('Phase 2/5: Generating content blocks...', 25);
  const contentMap: Record<string, ContentMapEntry> = allTopics.length
    ? await generateAllContent(allTopics, researchMap, perTopic, courseTitle, apiKey, model)
    : {};
  const totalBlocks = Object.values(contentMap).reduce(
    (n, c) => n + c.content_blocks.length,
    0,
  );
  progress?.(
    `Phase 2/5: Content blocks — ${totalBlocks} blocks across ${Object.keys(contentMap).length} topics`,
    40,
  );

  // ── Phase 3: Editor (skeleton with infographic_assignments) ─────────
  progress?.('Phase 3/5: Building deck skeleton...', 45);
  const skeleton = await buildSkeleton(ctx, contentMap, apiKey, model);
  progress?.('Phase 3/5: Skeleton built', 50);

  // ── Phase 4: Infographic PNGs ──────────────────────────────────────
  progress?.('Phase 4/5: Generating infographic images...', 55);
  let infographicMap: Record<string, any[]> = {};
  if (!config.skip_infographics) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw_v3_infographics_'));
    try {
      infographicMap = await generateAllInfographics(skeleton as any, contentMap as any, tmp);
    } catch (e: any) {
      console.error('[cw-slides-v3] infographic phase failed:', e.message);
    }
  }
  const allInfographics = Object.values(infographicMap).flat();
  const genInfographics = allInfographics.filter((r: any) => r?.generated).length;
  const totalInfographics = allInfographics.length;
  progress?.(`Phase 4/5: Infographics — ${genInfographics}/${totalInfographics}`, 75);

  // ── Phase 5: Assembly + PPTX build ──────────────────────────────────
  progress?.('Phase 5/5: Assembling slides and building PPTX...', 80);
  const luDataMap = assembleLuData(skeleton, contentMap, infographicMap as any);
  const { buffer, slideCount } = await buildPptxBuffer(
    ctx,
    skeleton as any,
    luDataMap as any,
    company,
    target,
  );
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

export type { CwCompanyInfo, SlideAgentConfig, SlideTopic, SlidesResult } from './types';
