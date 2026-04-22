/**
 * Assessment Plan evidence extraction — TypeScript port of the Streamlit
 * `generate_assessment_plan` helper's evidence-extraction agent.
 *
 * Calls Claude via `@anthropic-ai/claude-agent-sdk` to produce structured
 * Evidence / Submission / Marking_Process / Retention_Period data for each
 * AP assessment method (PP, CS, OQ, RP). The data is merged into the caller's
 * `Assessment_Methods_Details` so the AP DOCX template can render the
 * Evidence Gathering Plan section.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeEnv } from './anthropic-auth';

const SYSTEM_PROMPT = `Based on the following course details, you are to provide structured justifications for the selected Assessment Methods, aligning them with Learning Outcomes (LOs) and Topics.

**Your Task:**
Generate structured justifications for applicable assessment methods. WA(Q&A), PP, CS, OQ all use the per-LO list shape; RP uses the special string form:

For each method, extract:
1. **Type of Evidence**: For PP/CS/OQ, a list of objects \`{"LO": "ELO1", "Evidence": "..."}\` — one entry per Learning Outcome. For RP it is the literal string "Role Play".
2. **Manner of Submission**: A list of plain-text strings (no objects).
3. **Marking Process**: A list of plain-text strings (3 short evaluation criteria).
4. **Retention Period**: A single plain-text string.

**Rules:**
- Replace "students" with "candidates."
- Replace "instructors" with "assessors."
- Ensure all LOs are addressed exactly once each in Evidence.
- Bullet points: Max 30 words each.
- Marking Process: Max 6 words per evaluation, 3 evaluations total.

Return ONLY valid JSON (no prose, no markdown fences) in this shape:
{
  "assessment_methods": {
    "WA(Q&A)": {
      "evidence": [
        {"LO": "ELO1", "Evidence": "..."},
        {"LO": "ELO2", "Evidence": "..."}
      ],
      "submission": ["..."],
      "marking_process": ["...", "...", "..."],
      "retention_period": "..."
    },
    "PP": { ...same shape... },
    "CS": { ...same shape... },
    "OQ": { ...same shape... },
    "RP": {
      "evidence": "Role Play",
      "submission": ["..."],
      "marking_process": ["...", "...", "..."],
      "retention_period": "...",
      "no_of_scripts": "..."
    }
  }
}

Only include methods that apply to this course. Omit entries for methods not in the course's assessment method list. Use the Learning-Outcome labels (ELO1, ELO2, ...) extracted from the supplied LO list.`;

type Dict = Record<string, any>;

interface EvidenceEntry {
  evidence?: string[] | string;
  submission?: string[];
  marking_process?: string[];
  retention_period?: string;
  no_of_scripts?: string;
}

interface EvidenceResponse {
  assessment_methods: Record<string, EvidenceEntry>;
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  // Strip common markdown code fence patterns first.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : trimmed;
  // Fall back to the first `{...}` block.
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('No JSON object found in model response');
  return JSON.parse(objMatch[0]);
}

function buildUserPrompt(context: Dict): string {
  const courseTitle = context.Course_Title || context.courseTitle || 'Course';
  const los = (context.Learning_Units || context.learningUnits || [])
    .map((lu: Dict, i: number) => {
      const lo = lu.LO || lu.learningOutcome || '';
      const luTitle = lu.LU_Title || lu.luTitle || `LU${i + 1}`;
      return `- ${luTitle}: ${lo}`;
    })
    .join('\n');
  const topics = (context.Learning_Units || context.learningUnits || [])
    .flatMap((lu: Dict) => {
      const topicsArr = lu.Topics || lu.topics || [];
      return topicsArr.map((t: Dict) => {
        const title = t.Topic_Title || t.title || '';
        const bullets = (t.Bullet_Points || t.bulletPoints || []).join('; ');
        return `  - ${title}${bullets ? ' — ' + bullets : ''}`;
      });
    })
    .join('\n');
  const methodAbbrs = (context.Assessment_Methods_Details || context.assessmentMethodsDetails || [])
    .map((am: Dict) => am.Method_Abbreviation || am.abbreviation || '')
    .filter(Boolean)
    .join(', ');

  return `**Course Details:**
- **Course Title:** ${courseTitle}
- **Learning Outcomes:**
${los || '(none supplied)'}
- **Topics Covered:**
${topics || '(none supplied)'}
- **Assessment Methods:** ${methodAbbrs || '(none supplied)'}

Your task is to generate the assessment evidence gathering plan. Return the data as a valid JSON object.`;
}

export async function generateAssessmentEvidence(
  context: Dict,
  apiKey: string,
): Promise<EvidenceResponse | null> {
  const userPrompt = buildUserPrompt(context);
  let text = '';
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      env: buildClaudeEnv(apiKey),
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === 'assistant' && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if (block.type === 'text') text += block.text;
      }
    }
  }
  if (!text.trim()) return null;
  try {
    const parsed = extractJson(text);
    if (parsed && parsed.assessment_methods) return parsed as EvidenceResponse;
    return null;
  } catch (e) {
    console.error('[cw-evidence-agent] Failed to parse JSON:', (e as Error).message);
    return null;
  }
}

// ── Narrative enrichment (Course_Overview / LO_Description / Proficiency_Description) ──

const NARRATIVE_SYSTEM_PROMPT = `You are a WSQ courseware writer. Given a course's title, learning outcomes and topics, produce concise narrative content suitable for the Learner Guide and Facilitator's Guide cover sections.

Return ONLY valid JSON (no prose, no markdown fences) with this shape:
{
  "Course_Overview": "string — 2-3 short paragraphs describing what the course covers and who it's for. Plain text, no bullets.",
  "LO_Description": "string — a single short paragraph describing what learners will be able to do by the end of the course (synthesises all LOs).",
  "Proficiency_Description": "string — a short paragraph (Skills Framework style) describing the proficiency level the course targets and the responsibilities a candidate at that level holds."
}

Rules:
- Replace "students" with "candidates" / "learners".
- Replace "instructors" with "trainers" / "assessors".
- Plain prose only — no Markdown, no bullet points, no headings.
- Keep each field tight: Course_Overview ≤ 120 words, LO_Description ≤ 60 words, Proficiency_Description ≤ 60 words.
- Don't fabricate concrete tools/standards that aren't implied by the LOs/Topics.`;

interface NarrativeResponse {
  Course_Overview?: string;
  LO_Description?: string;
  Proficiency_Description?: string;
}

function buildNarrativeUserPrompt(context: Dict): string {
  const courseTitle = context.Course_Title || context.courseTitle || 'Course';
  const tscTitle = context.TSC_Title || context.tscTitle || '';
  const tscCode = context.TSC_Code || context.tscCode || '';
  const profLevel = context.Proficiency_Level || '';
  const lus = context.Learning_Units || context.learningUnits || [];
  const los = lus
    .map((lu: Dict, i: number) => `- ${lu.LO || lu.learningOutcome || `LO${i + 1}`}`)
    .join('\n');
  const topics = lus
    .flatMap((lu: Dict) => (lu.Topics || lu.topics || []).map((t: Dict) => `  • ${t.Topic_Title || t.title || ''}`))
    .join('\n');
  return `**Course Title:** ${courseTitle}
**TSC:** ${tscTitle} (${tscCode}) — ${profLevel}

**Learning Outcomes:**
${los || '(none)'}

**Topics:**
${topics || '(none)'}

Generate the narrative JSON described in the system prompt.`;
}

export async function generateCoursewareNarrative(
  context: Dict,
  apiKey: string,
): Promise<NarrativeResponse | null> {
  const userPrompt = buildNarrativeUserPrompt(context);
  let text = '';
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: NARRATIVE_SYSTEM_PROMPT,
      env: buildClaudeEnv(apiKey),
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === 'assistant' && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if (block.type === 'text') text += block.text;
      }
    }
  }
  if (!text.trim()) return null;
  try {
    return extractJson(text) as NarrativeResponse;
  } catch (e) {
    console.error('[cw-evidence-agent] narrative parse failed:', (e as Error).message);
    return null;
  }
}

export function mergeNarrativeIntoContext(
  context: Dict,
  narrative: NarrativeResponse | null,
): Dict {
  if (!narrative) return context;
  const out = { ...context };
  for (const key of ['Course_Overview', 'LO_Description', 'Proficiency_Description'] as const) {
    const incoming = narrative[key];
    const existing = out[key];
    if (typeof incoming === 'string' && incoming.trim() && (!existing || String(existing).trim() === '')) {
      out[key] = incoming.trim();
    }
  }
  return out;
}

/**
 * Merge the agent's evidence output into the caller's Assessment_Methods_Details.
 * Mirrors `combine_assessment_methods` from the Streamlit project.
 */
export function mergeEvidenceIntoDetails(
  details: Dict[],
  evidence: EvidenceResponse | null,
): Dict[] {
  if (!evidence || !evidence.assessment_methods) return details;
  return details.map((am) => {
    const abbr = String(am.Method_Abbreviation || am.abbreviation || '');
    const entry = evidence.assessment_methods[abbr];
    if (!entry) return am;

    const merged: Dict = { ...am };
    const isRP = abbr === 'RP';

    if (abbr === 'WA-SAQ') {
      // WA-SAQ usually gets a single string for evidence/submission/marking.
      if (entry.evidence !== undefined) merged.Evidence = entry.evidence;
      if (entry.submission !== undefined) merged.Submission = entry.submission;
      if (entry.marking_process !== undefined) merged.Marking_Process = entry.marking_process;
    } else if (abbr === 'WA(Q&A)') {
      // WA(Q&A) uses the same per-LO list shape as PP/CS in the reference doc.
      merged.Evidence = entry.evidence ?? [];
      merged.Submission = entry.submission ?? [];
      merged.Marking_Process = entry.marking_process ?? [];
    } else if (isRP) {
      merged.Evidence = entry.evidence ?? 'Role Play';
      merged.Submission = entry.submission ?? [];
      merged.Marking_Process = entry.marking_process ?? [];
      merged.No_of_Scripts = entry.no_of_scripts ?? 'Not specified';
    } else {
      // PP, CS, OQ — all list-shaped.
      merged.Evidence = entry.evidence ?? [];
      merged.Submission = entry.submission ?? [];
      merged.Marking_Process = entry.marking_process ?? [];
    }
    if (entry.retention_period) merged.Retention_Period = entry.retention_period;
    return merged;
  });
}
