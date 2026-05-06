/**
 * PPTX builder for v3 — re-exports v1's tested PPTX rendering primitives.
 *
 * Streamlit's analogue: agents in `courseware_agents/` orchestrate the
 * pipeline, while `generate_slides/build_pptx.py` handles raw PPTX rendering.
 * We follow the same separation: phase modules in `lib/cw-slides-v3/`
 * orchestrate, while v1's WSQ-templated slide layouts (cover, section
 * divider, infographic slide, activity slide, etc.) stay in
 * `lib/cw-slides.ts` because they're already production-tested with the
 * exact WSQ template asset paths and EMU positions.
 *
 * The v1 PPTX builder applies all user rule fixes from earlier sessions:
 * - infographic-only content slides (no text-bullet fallback)
 * - parenthetical strip on K&A / Outline / Activity titles
 * - LU section dividers
 * - scrubPptxBuffer (zero-dim grpSpPr xfrm fix so PowerPoint opens cleanly)
 */

export {
  buildPptxBuffer,
  scrubPptxBuffer,
  normaliseContext,
  makePres,
  addIntroSlides,
  addLuSlides,
  addClosingSlides,
} from '../cw-slides';
