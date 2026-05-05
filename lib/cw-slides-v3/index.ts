/**
 * Public entry point for v3 — Streamlit-faithful 5-phase slide pipeline.
 *
 * Same surface as v1/v2 so the API endpoint at
 * pages/api/developer/cw-generate-slides.ts swaps with a single import line:
 *
 *   import { generateSlides } from '../../../lib/cw-slides-v3';
 */

export { generateSlides } from './orchestrator';
export type {
  CwCompanyInfo,
  SlideAgentConfig,
  SlideTopic,
  SlidesResult,
  ContentBlock,
  ContentMapEntry,
  ResearchEntry,
  ActivityData,
} from './types';
