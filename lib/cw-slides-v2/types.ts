/**
 * Shared types for the v2 slide generation pipeline.
 *
 * These mirror the Streamlit reference (multi_agent_orchestrator.py +
 * content_generator_agent.py + research_agent.py) so the TS port behaves
 * identically downstream.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public API types — match v1 so the API endpoint can swap imports cleanly
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
// Phase 1 — Research
// ────────────────────────────────────────────────────────────────────────────

export interface ResearchSource {
  title?: string;
  url?: string;
  key_findings?: string[];
  date?: string;
  type?: string;
  relevance_score?: number;
}

export interface ResearchEntry {
  topic: string;
  sources?: ResearchSource[];
  summary?: string;
  search_queries_used?: string[];
  key_statistics?: Array<{ stat: string; source?: string; chart_type?: string }>;
  recommended_frameworks?: string[];
  infographic_data?: {
    chart_data?: Array<{ label: string; value: number; source?: string }>;
    process_steps?: string[];
    comparison_items?: Array<{ label: string; desc: string }>;
    hierarchy_data?: Record<string, unknown>;
    timeline_data?: Array<{ year: string; event: string }>;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — Content blocks
// ────────────────────────────────────────────────────────────────────────────

export interface ContentBlockItem {
  label: string;
  desc?: string;
  icon?: string;
  value?: number;
  children?: ContentBlockItem[];
}

export interface ContentBlock {
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

export interface ActivityData {
  title?: string;
  scenario?: string;
  steps?: string[];
  expected_output?: string;
  duration?: string;
}

export interface ContentMapEntry {
  topic: string;
  content_blocks: ContentBlock[];
  activity?: ActivityData;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — Skeleton
// ────────────────────────────────────────────────────────────────────────────

export interface InfographicAssignment {
  slide_position: number;
  content_block_index: number;
  sub_title: string;
  visualization_type: string;
  assigned_template: string;
}

export interface SkeletonTopic {
  topic_title: string;
  topic_number: string;
  infographic_assignments: InfographicAssignment[];
}

export interface SkeletonLu {
  lu_number: string;
  lu_title: string;
  topics: SkeletonTopic[];
}

export interface SkeletonLo {
  lo_number: string;
  lo_title: string;
  learning_units: SkeletonLu[];
}

export interface Skeleton {
  learning_outcomes: SkeletonLo[];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — Infographic results
// ────────────────────────────────────────────────────────────────────────────

export interface InfographicResult {
  topic_title: string;
  slide_position: number;
  sub_title: string;
  image_path: string | null;
  caption: string;
  generated: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 — Assembly
// ────────────────────────────────────────────────────────────────────────────

export interface AssemblyTopicSlide {
  position: number;
  title: string;
  image_path: string | null;
  caption: string;
  fallback_bullets: string[];
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
