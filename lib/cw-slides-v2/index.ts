/**
 * Public entry point for the v2 slide generation pipeline.
 *
 * Drop-in replacement for `lib/cw-slides`. Same `generateSlides()` signature.
 * Switch by changing the import in pages/api/developer/cw-generate-slides.ts:
 *   from: '../../../lib/cw-slides'
 *   to:   '../../../lib/cw-slides-v2'
 */

export { generateSlides } from './orchestrator';
export type { CwCompanyInfo, SlideAgentConfig, SlideTopic, SlidesResult } from './types';
