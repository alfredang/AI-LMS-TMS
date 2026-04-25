/**
 * Courseware Audit — TypeScript port of the Streamlit reference
 * (alfredang/wsq-courseware-generator-claude-streamlit, courseware_audit/).
 *
 * Three responsibilities:
 *   1. Extract text/fields from uploaded CP and courseware docs
 *      (.docx via mammoth, .xlsx via xlsx, with direct cell parsing
 *      for CP Excel files when possible).
 *   2. Use Claude to extract structured audit fields from a courseware
 *      document's text — same JSON schema and system prompt as the
 *      Streamlit reference.
 *   3. Compare each courseware doc's fields against the CP's
 *      "expected" fields and produce a per-field status
 *      (match | mismatch | missing | n/a).
 *
 * Field set mirrors the Streamlit audit_agent verbatim.
 */

import mammoth from 'mammoth';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as XLSX from 'xlsx';
import { buildClaudeEnv } from './anthropic-auth';

// ── Field schema ────────────────────────────────────────────────────────────
export type AuditDocType = 'AP' | 'ASR' | 'FG' | 'LG' | 'LP';
export const AUDIT_DOC_TYPES: AuditDocType[] = ['AP', 'ASR', 'FG', 'LG', 'LP'];

// Keys must match the JSON the Claude prompt asks for, plus the duration
// sub-keys broken out for individual checklist toggling.
export const AUDIT_FIELD_KEYS = [
  'tgs_ref_code',
  'course_title',
  'company_name',
  'tsc_ref_code',
  'tsc_title',
  'training_hours',
  'assessment_hours',
  'total_hours',
  'learning_outcomes',
  'topics',
  'assessment_methods',
  'instructional_methods',
] as const;
export type AuditFieldKey = (typeof AUDIT_FIELD_KEYS)[number];

export const AUDIT_FIELD_LABELS: Record<AuditFieldKey, string> = {
  tgs_ref_code: 'TGS Reference Code',
  course_title: 'Course Title',
  company_name: 'Company Name',
  tsc_ref_code: 'TSC Reference Code',
  tsc_title: 'TSC Title',
  training_hours: 'Training Hours',
  assessment_hours: 'Assessment Hours',
  total_hours: 'Total Hours',
  learning_outcomes: 'Learning Outcomes',
  topics: 'Topics',
  assessment_methods: 'Assessment Methods',
  instructional_methods: 'Instructional Methods',
};

// Streamlit-parity field-type map. Determines which comparator runs:
//   - "string" → loose string compare (case-insensitive, contains-OK)
//   - "duration" → numeric-hours compare (handles "1 hrs", "60 mins",
//     "1 hour 30 minutes" etc. as equivalent values)
//   - "list" → set-membership compare
const FIELD_TYPE: Record<AuditFieldKey, 'string' | 'duration' | 'list'> = {
  tgs_ref_code: 'string',
  course_title: 'string',
  company_name: 'string',
  tsc_ref_code: 'string',
  tsc_title: 'string',
  training_hours: 'duration',
  assessment_hours: 'duration',
  total_hours: 'duration',
  learning_outcomes: 'list',
  topics: 'list',
  assessment_methods: 'list',
  instructional_methods: 'list',
};

// Per-doc-type applicability — mirrors audit_extraction.md from the
// Streamlit reference, with refinements based on what each doc actually
// carries in our codebase:
//   - Topics removed from AP/ASR — those docs only carry LU titles in
//     the assessment-methods table, not actual topic text.
//   - Learning outcomes removed from ALL doc types — none of the
//     courseware templates render the verbatim LO sentence per LU. The
//     FG/LG mapping cell only shows the ELO label ("ELO1"), not the
//     CP's full outcome text. AP/ASR matrices likewise carry only
//     ELO labels. So there's nothing to compare against the CP's full
//     learning outcome text.
//   - ASR is treated like AP (same field surface).
const APPLICABLE_TYPES: Record<AuditFieldKey, AuditDocType[]> = {
  course_title: ['AP', 'ASR', 'FG', 'LG', 'LP'],
  tgs_ref_code: ['AP', 'ASR', 'FG', 'LG', 'LP'],
  topics: ['FG', 'LG', 'LP'],
  company_name: ['AP', 'ASR', 'FG', 'LG', 'LP'],
  training_hours: ['FG', 'LP'],
  assessment_hours: ['AP', 'ASR', 'FG', 'LP'],
  total_hours: ['FG', 'LP'],
  // FG/LG mapping cells now render the full ELO sentence per LU
  // (e.g. "ELO1: Apply ethical judgement to evaluate generative AI
  // outputs..."), so the audit can compare them against the CP's
  // Learning Outcome column. AP/ASR/LP still don't carry the verbatim
  // text — they only have ELO labels — so they stay excluded.
  learning_outcomes: ['FG', 'LG'],
  assessment_methods: ['AP', 'ASR', 'FG'],
  instructional_methods: ['FG', 'LP'],
  tsc_ref_code: ['AP', 'ASR', 'FG'],
  tsc_title: ['AP', 'ASR', 'FG'],
};

export interface AuditFields {
  tgs_ref_code: string | null;
  course_title: string | null;
  company_name: string | null;
  tsc_ref_code: string | null;
  tsc_title: string | null;
  training_hours: string | null;
  assessment_hours: string | null;
  total_hours: string | null;
  learning_outcomes: string[];
  topics: string[];
  assessment_methods: string[];
  instructional_methods: string[];
}

// ── File text extraction ────────────────────────────────────────────────────

function looksDocx(buffer: Buffer): boolean {
  // .docx is a zip — first two bytes are "PK"
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return extractXlsxText(buffer);
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc') || looksDocx(buffer)) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  // Fallback — treat as plain text
  return buffer.toString('utf-8');
}

function extractXlsxText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sections: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ' | ' });
    sections.push(`# Sheet: ${name}\n${csv}`);
  }
  return sections.join('\n\n');
}

// ── CP field extraction (Excel direct + Claude fallback) ────────────────────

// Streamlit's CP Excel template uses fixed cell positions for the most
// stable fields. When a .xlsx is uploaded we try those first (fast,
// deterministic) and fall through to Claude extraction for anything
// missing, exactly mirroring the reference.
const CP_EXCEL_CELL_HINTS: Partial<Record<AuditFieldKey, string[]>> = {
  course_title: ['Course Title', 'Title of Course', 'Course Name'],
  tgs_ref_code: ['TGS Reference', 'TGS Ref', 'Course Ref'],
  tsc_ref_code: ['TSC Reference', 'TSC Code', 'Skill Code'],
  tsc_title: ['TSC Title', 'TSC Name'],
  company_name: ['Organisation', 'Company Name', 'Training Provider'],
  training_hours: ['Training Hours', 'Total Training', 'Instructional Hours'],
  assessment_hours: ['Assessment Hours', 'Total Assessment'],
  total_hours: ['Total Hours', 'Total Course Duration', 'Total Duration'],
};

// Word-boundary "starts-with-the-hint" test. The previous substring match
// was too loose — "training provider" hit any header containing those
// words (e.g. "Terms for Training Providers (Annex A)"), causing the
// company_name to be wrong. We now require the hint to be the start of
// the label or to match on a word boundary.
function isLabelMatch(cellText: string, hint: string): boolean {
  const lower = cellText.toLowerCase().trim();
  const h = hint.toLowerCase().trim();
  if (lower === h) return true;
  if (lower.startsWith(h)) return true;
  // Allow trailing punctuation/colons/whitespace after the hint
  const re = new RegExp(`(^|\\b)${h.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b\\s*[:.\\-]?\\s*$`, 'i');
  return re.test(lower);
}

function tryExtractCpFromExcel(buffer: Buffer): Partial<AuditFields> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return {};
  }
  const partial: Partial<AuditFields> = {};
  // Streamlit reference walks columns B (labels) and reads value from C.
  // Generalise slightly: scan columns A and B for labels, take value from
  // the next non-empty cell on the same row. Restrict the search to the
  // first 60 rows of every sheet — CP frontmatter / metadata always sits
  // there, never deep in the body.
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const ref = sheet['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowMax = Math.min(range.e.r, range.s.r + 60);
    for (let r = range.s.r; r <= rowMax; r++) {
      for (let c = range.s.c; c <= Math.min(range.s.c + 1, range.e.c); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (!cell || cell.v == null) continue;
        const text = String(cell.v).trim();
        if (!text || text.length > 80) continue; // labels are short; skip body paragraphs
        for (const [key, hints] of Object.entries(CP_EXCEL_CELL_HINTS) as [AuditFieldKey, string[]][]) {
          if (partial[key]) continue;
          if (hints.some((h) => isLabelMatch(text, h))) {
            for (let cc = c + 1; cc <= range.e.c; cc++) {
              const vCell = sheet[XLSX.utils.encode_cell({ r, c: cc })];
              if (vCell && vCell.v != null && String(vCell.v).trim()) {
                (partial as any)[key] = String(vCell.v).trim();
                break;
              }
            }
          }
        }
      }
    }
  }
  return partial;
}

// ── Claude extraction ──────────────────────────────────────────────────────

const AUDIT_SYSTEM_PROMPT = `You are a WSQ courseware document auditor.

Your task is to extract specific fields from a courseware document for audit purposes.
The document may be an Assessment Plan (AP), Assessment Specification Records (ASR),
Facilitator Guide (FG), Learner Guide (LG), or Lesson Plan (LP).

Extract ALL of the following fields. If a field is not found, use null.

CRITICAL: Return ONLY a valid JSON object with no additional text.

The JSON must follow this schema:
{
    "tgs_ref_code": "string or null - TGS Reference Code (e.g., TGS-2024-12345)",
    "course_title": "string or null - Full course title",
    "company_name": "string or null - Training provider / company name",
    "tsc_ref_code": "string or null - Technical Skills & Competency code (e.g., ICT-DIT-3001-1.1)",
    "tsc_title": "string or null - TSC title / competency name",
    "learning_outcomes": [
        "string - LO1: description",
        "string - LO2: description"
    ],
    "training_hours": "string or null - e.g., '16 hrs'",
    "assessment_hours": "string or null - e.g., '2 hrs'",
    "total_hours": "string or null - e.g., '18 hrs'",
    "topics": [
        "string - Topic title 1",
        "string - Topic title 2"
    ],
    "assessment_methods": [
        "string - copy the method name EXACTLY as it appears in the document. Preserve 'Others:' prefix when present (e.g. 'Written Exam' or 'Others: Case Study'). Do NOT expand abbreviations or append the abbr in parentheses."
    ],
    "instructional_methods": [
        "string - e.g., Lecture",
        "string - e.g., Group Discussion"
    ]
}

RULES:
- Extract the EXACT values as they appear in the document
- For learning outcomes, include the LO number prefix (LO1, LO2, etc.)
- **CRITICAL — for assessment_methods:**
  - Extract EVERY method the document mentions in any structural section: the "Assessment Methods" / "Learning Unit → Assessment Method(s)" table, "Assessment Specifications" headings ("Assessment Specification for X"), "Assessment Record for X" headings, the Evidence Gathering Plan rows, AND the column headers of the "Assessment Summary Record" table (commonly abbreviations like "WE", "CS", "WA-SAQ", "PP" — each is a method).
  - DO NOT extract from "Legend" / "Glossary" / footnote rows that simply explain what abbreviations stand for (e.g. ignore "Legend: WA-SAQ: Written Assessment, PP: Practical Performance, CS: Case Study, OQ: Oral Questioning, RP: Role Play"). Identify legend rows by the "Legend:" label; everything in that row is a definition list, not the document's actual methods.
  - When a method appears as an abbreviation in column headers (e.g. "WE" or "CS"), include it in the output exactly as written — do not expand it.
  - **OUTPUT method names EXACTLY as they appear in the document, character-for-character. PRESERVE "Others:" prefixes (e.g. output "Others: Case Study", not "Case Study"). DO NOT expand abbreviations to standardised long names — if the doc says "Written Exam", output "Written Exam".**
- **CRITICAL — for topics:**
  - Extract ONLY the top-level topic TITLES (e.g. "Ethical considerations and potential risks of generative AI interaction", "Ethical principles in AI", "Apply ethical principles in decision-making related to AI").
  - DO NOT include the elaboration / sub-bullet points that appear UNDER each topic in the FG / LG mapping cell (e.g. ignore short bullets like "Understanding ethical challenges in AI interaction", "Identifying potential risks and consequences"). Those are facilitator notes, not topic titles.
  - In the FG / LG cell, the bold lines starting with capital letters are topic titles; the indented bullets that follow are NOT topics. Keep the bold titles only.
- Return empty arrays [] if no items found for list fields
- Be thorough - scan the entire document content`;

// Cap each doc's text at ~60K chars (~15K tokens). Real-world AP/FG/LG
// docs from this codebase routinely exceed 200K chars which blows past
// the Claude Agent SDK's effective per-prompt limit ("Prompt is too long"
// error). When truncating we keep both the head (cover, course-meta,
// learning-outcomes section) AND the tail (assessment-method tables
// commonly live at the end), with a `[...truncated...]` marker between.
const MAX_DOC_CHARS = 60000;
const HEAD_BIAS = 0.7; // 70% head, 30% tail when we have to chop the middle

function trimDocForPrompt(text: string): string {
  if (text.length <= MAX_DOC_CHARS) return text;
  const headLen = Math.floor(MAX_DOC_CHARS * HEAD_BIAS);
  const tailLen = MAX_DOC_CHARS - headLen;
  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  return `${head}\n\n[... truncated ${text.length - MAX_DOC_CHARS} characters from middle ...]\n\n${tail}`;
}

async function extractFieldsViaClaude(text: string, docType: string, apiKey: string): Promise<AuditFields> {
  const trimmed = trimDocForPrompt(text);
  const userPrompt = `${AUDIT_SYSTEM_PROMPT}\n\nDocument type: ${docType}\n\nDocument content:\n\n${trimmed}\n\nReturn the JSON now.`;
  let raw = '';
  for await (const message of query({
    prompt: userPrompt,
    options: {
      env: buildClaudeEnv(apiKey),
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text') raw += block.text;
      }
    }
  }
  return parseAuditJson(raw);
}

function parseAuditJson(raw: string): AuditFields {
  // Find the first JSON object in the response. Claude sometimes wraps
  // JSON in ```json fences or adds preamble text — strip both.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Audit response was not valid JSON: ${raw.slice(0, 200)}`);
  const obj = JSON.parse(candidate.slice(start, end + 1));
  return {
    tgs_ref_code: typeof obj.tgs_ref_code === 'string' ? obj.tgs_ref_code : null,
    course_title: typeof obj.course_title === 'string' ? obj.course_title : null,
    company_name: typeof obj.company_name === 'string' ? obj.company_name : null,
    tsc_ref_code: typeof obj.tsc_ref_code === 'string' ? obj.tsc_ref_code : null,
    tsc_title: typeof obj.tsc_title === 'string' ? obj.tsc_title : null,
    training_hours: typeof obj.training_hours === 'string'
      ? obj.training_hours
      : (obj.durations && typeof obj.durations.training_hours === 'string' ? obj.durations.training_hours : null),
    assessment_hours: typeof obj.assessment_hours === 'string'
      ? obj.assessment_hours
      : (obj.durations && typeof obj.durations.assessment_hours === 'string' ? obj.durations.assessment_hours : null),
    total_hours: typeof obj.total_hours === 'string'
      ? obj.total_hours
      : (obj.durations && typeof obj.durations.total_hours === 'string' ? obj.durations.total_hours : null),
    learning_outcomes: Array.isArray(obj.learning_outcomes) ? obj.learning_outcomes.filter((x: any) => typeof x === 'string') : [],
    topics: Array.isArray(obj.topics) ? obj.topics.filter((x: any) => typeof x === 'string') : [],
    assessment_methods: Array.isArray(obj.assessment_methods) ? obj.assessment_methods.filter((x: any) => typeof x === 'string') : [],
    instructional_methods: Array.isArray(obj.instructional_methods) ? obj.instructional_methods.filter((x: any) => typeof x === 'string') : [],
  };
}

export async function extractCpFields(buffer: Buffer, fileName: string, apiKey: string): Promise<AuditFields> {
  const lower = fileName.toLowerCase();
  let partial: Partial<AuditFields> = {};
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    partial = tryExtractCpFromExcel(buffer);
  }
  // Always do a Claude pass on the extracted text to fill in lists
  // (learning_outcomes, topics, methods) which the Excel hint-walker
  // can't reliably grab.
  const text = await extractTextFromBuffer(buffer, fileName);
  const aiFields = await extractFieldsViaClaude(text, 'CP (Course Proposal)', apiKey);
  return {
    ...aiFields,
    // Excel direct-cell values win when present (more reliable than AI guesses)
    ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v != null && v !== '')),
  } as AuditFields;
}

export async function extractCoursewareFields(
  buffer: Buffer,
  fileName: string,
  docType: AuditDocType,
  apiKey: string,
): Promise<AuditFields> {
  const text = await extractTextFromBuffer(buffer, fileName);
  return extractFieldsViaClaude(text, docType, apiKey);
}

// ── Comparison ──────────────────────────────────────────────────────────────

export type CompareStatus = 'match' | 'mismatch' | 'missing' | 'na';

export interface FieldComparison {
  field: AuditFieldKey;
  label: string;
  status: CompareStatus;
  expected: string | string[] | null;
  got: string | string[] | null;
}

export interface DocComparison {
  fileName: string;
  docType: AuditDocType;
  fields: FieldComparison[];
  passCount: number;
  failCount: number;
  missingCount: number;
}

function normaliseScalar(v: string | null | undefined): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\d.\- ]/g, '')
    .trim();
}

// Canonical method-name normaliser. The CP, FG, AP can each refer to the
// same assessment method using different surface forms — "Written Exam",
// "Written Assessment - Short Answer Questions", "WA-SAQ", "Others: Case
// Study" / "Case Study", etc. Map each to a single canonical abbreviation
// so the audit comparator treats them as the same item.
const METHOD_NAME_TO_ABBR: { match: RegExp; abbr: string }[] = [
  // Order matters — the FIRST match wins. Put more specific patterns first
  // (e.g. "oral clarification" before bare "OC", "oral questioning" before
  // bare "OQ") so they don't get short-circuited by a generic abbreviation
  // match earlier in the list.
  { match: /written\s*assessment/i, abbr: 'WA-SAQ' },
  { match: /written\s*exam/i, abbr: 'WA-SAQ' },
  { match: /\bWA[-\s]?SAQ\b/i, abbr: 'WA-SAQ' },
  { match: /\bWA[(]?Q\s*&\s*A[)]?\b/i, abbr: 'WA-SAQ' },
  { match: /\bWE\b/i, abbr: 'WA-SAQ' },
  { match: /practical\s*performance/i, abbr: 'PP' },
  { match: /practical\s*exam/i, abbr: 'PP' },
  { match: /\bPP\b/i, abbr: 'PP' },
  { match: /case\s*study/i, abbr: 'CS' },
  { match: /case\s*studies/i, abbr: 'CS' },
  { match: /\bCS\b/i, abbr: 'CS' },
  { match: /oral\s*questioning/i, abbr: 'OQ' },
  { match: /oral\s*clarification/i, abbr: 'OC' },
  { match: /oral\s*interview/i, abbr: 'OI' },
  { match: /\bOC\b/i, abbr: 'OC' },
  { match: /\bOQ\b/i, abbr: 'OQ' },
  { match: /\bOI\b/i, abbr: 'OI' },
  { match: /role\s*play/i, abbr: 'RP' },
  { match: /\bRP\b/i, abbr: 'RP' },
  { match: /demonstration/i, abbr: 'DEM' },
  { match: /\bDEM\b/i, abbr: 'DEM' },
  { match: /project/i, abbr: 'PRJ' },
  { match: /\bPRJ\b/i, abbr: 'PRJ' },
  { match: /assignment/i, abbr: 'ASGN' },
  { match: /\bASGN\b/i, abbr: 'ASGN' },
  { match: /online\s*test/i, abbr: 'OT' },
  { match: /\bOT\b/i, abbr: 'OT' },
];

function normaliseMethodName(name: string): string {
  // Strip "Others:" prefix and any "(WA-SAQ)" trailing parens, then map
  // to the canonical abbreviation if recognisable; otherwise return the
  // cleaned scalar form so unknown methods still compare consistently.
  const cleaned = String(name || '')
    .replace(/^\s*Others\s*:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  for (const { match, abbr } of METHOD_NAME_TO_ABBR) {
    if (match.test(cleaned)) return abbr;
  }
  return normaliseScalar(cleaned);
}

// Convert any duration string to a numeric value in HOURS so different
// units compare equal. Mirror of the Streamlit `_normalize_number`.
//
//   "22 hrs"             → 22
//   "30 mins"            → 0.5
//   "1.5 hours"          → 1.5
//   "60 minutes"         → 1
//   "1 hour 30 minutes"  → 1.5
//   "8 hour 0 minutes"   → 8
//   "30 min"             → 0.5
function normaliseDuration(val: string | null | undefined): number | null {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (!s) return null;
  // Compound "X hour(s) Y minute(s)"
  const compound = s.match(/(\d+\.?\d*)\s*hours?\s+(\d+\.?\d*)\s*min/);
  if (compound) {
    const hours = parseFloat(compound[1]);
    const mins = parseFloat(compound[2]);
    return Math.round((hours + mins / 60) * 100) / 100;
  }
  // Minutes only
  if (/\bmin/.test(s) && !/\bhour|\bhr/.test(s)) {
    const m = s.match(/(\d+\.?\d*)/);
    if (m) return Math.round((parseFloat(m[1]) / 60) * 100) / 100;
  }
  // Hours (default — also bare numbers)
  const m = s.match(/(\d+\.?\d*)/);
  if (m) return Math.round(parseFloat(m[1]) * 100) / 100;
  return null;
}

function compareScalar(expected: string | null, got: string | null): CompareStatus {
  const exp = normaliseScalar(expected);
  const g = normaliseScalar(got);
  // If the doc doesn't carry this field, treat it as not-applicable rather
  // than failing the audit — supervisor's rule: missing means the doc
  // doesn't need it.
  if (!g) return 'na';
  if (!exp) return 'na';
  if (exp === g) return 'match';
  if (exp.includes(g) || g.includes(exp)) return 'match';
  return 'mismatch';
}

// Looser scalar comparator for fields like Company Name where one side
// might say "Tertiary Infotech Academy Pte Ltd" and the other says
// "TERTIARY INFOTECH PTE. LTD." — same entity, but case differs and one
// adds "Academy" / drops a period. Match if 70% of significant tokens
// from the shorter side appear in the longer side.
function compareNameLoose(expected: string | null, got: string | null): CompareStatus {
  if (!got) return 'na';
  if (!expected) return 'na';
  if (compareScalar(expected, got) === 'match') return 'match';
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[.,;:()-]/g, ' ').split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  const eT = tokens(expected);
  const gT = tokens(got);
  if (eT.length === 0 || gT.length === 0) return 'mismatch';
  const eSet = new Set(eT);
  const gSet = new Set(gT);
  const shorter = eSet.size <= gSet.size ? eSet : gSet;
  const longer = eSet.size <= gSet.size ? gSet : eSet;
  let overlap = 0;
  for (const t of shorter) if (longer.has(t)) overlap++;
  return overlap / shorter.size >= 0.7 ? 'match' : 'mismatch';
}

function compareDuration(
  expected: string | null,
  got: string | null,
  cp?: AuditFields,
): CompareStatus {
  const cpNum = normaliseDuration(expected);
  const docNum = normaliseDuration(got);
  if (cpNum == null && docNum == null) return 'na';
  // Treat a missing doc field as not-applicable rather than failure.
  if (docNum == null) return 'na';
  if (cpNum == null) return 'na';
  if (Math.abs(cpNum - docNum) < 0.01) return 'match';
  // Streamlit fallback: a doc's "total_hours" might be expressed as
  // training+assessment OR as one of them — accept the match if the doc
  // value equals either component or their sum.
  if (cp) {
    const t = normaliseDuration(cp.training_hours);
    const a = normaliseDuration(cp.assessment_hours);
    if (t != null && a != null && Math.abs(docNum - (t + a)) < 0.01) return 'match';
    if (t != null && Math.abs(docNum - t) < 0.01) return 'match';
    if (a != null && Math.abs(docNum - a) < 0.01) return 'match';
  }
  return 'mismatch';
}

// Token-based fuzzy match for list items. Necessary because the CP
// often carries long topic descriptions ("T1: Ethical considerations and
// potential risks of generative AI interaction") while a courseware doc
// shortens them ("T1: Generative AI Ethical Risks") — same topic,
// different wording, would fail a substring-only match. Strategy: try
// substring first (cheap, handles "WA-SAQ" abbreviation cases), then
// token-set Jaccard >= 0.3 on the de-prefixed text.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'have', 'has', 'had', 'will', 'shall', 'can', 'use', 'using', 'based',
  'into', 'their', 'these', 'those', 'such', 'about', 'over', 'between',
]);

function stripLabelPrefix(s: string): string {
  // Strip leading "T1:", "LU2:", "LO3:", "K1:", "A2:", etc.
  return s.replace(/^\s*(?:T|LU|LO|K|A)\s*\d+\s*:?\s*/i, '').trim();
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : inter / unionSize;
}

function listItemMatches(expectedItem: string, gotList: string[]): boolean {
  const eRaw = normaliseScalar(expectedItem);
  // 1. Direct (loose) substring match — covers abbreviation cases like
  //    "Written Assessment (WA-SAQ)" vs "WA-SAQ".
  if (
    gotList.some((g) => {
      const ng = normaliseScalar(g);
      return ng === eRaw || ng.includes(eRaw) || eRaw.includes(ng);
    })
  ) return true;

  // 2. Same idea but ignoring the "T1:"/"LO1:" label prefix.
  const eClean = stripLabelPrefix(expectedItem);
  const eCleanNorm = normaliseScalar(eClean);
  const cleanGot = gotList.map(stripLabelPrefix);
  if (
    cleanGot.some((g) => {
      const ng = normaliseScalar(g);
      return ng === eCleanNorm || ng.includes(eCleanNorm) || eCleanNorm.includes(ng);
    })
  ) return true;

  // 3. Token-set Jaccard >= 0.3 — handles paraphrased versions where
  //    the doc shortens or rewords the CP's text but keeps key nouns.
  const eTokens = tokenize(eClean);
  if (eTokens.length === 0) return true;
  return cleanGot.some((g) => jaccard(eTokens, tokenize(g)) >= 0.3);
}

function compareList(expected: string[], got: string[]): CompareStatus {
  if (expected.length === 0 && got.length === 0) return 'na';
  // Doc carries no items for this field → not-applicable, not a failure.
  if (got.length === 0) return 'na';
  const matched = expected.filter((e) => listItemMatches(e, got)).length;
  return matched / expected.length >= 0.6 ? 'match' : 'mismatch';
}

// Same as compareList but normalises every entry to its canonical method
// abbreviation first, so "Written Exam" and "Written Assessment - Short
// Answer Questions (WA-SAQ)" match as the same WA-SAQ method.
function compareMethods(expected: string[], got: string[]): CompareStatus {
  if (expected.length === 0 && got.length === 0) return 'na';
  if (got.length === 0) return 'na';
  const expSet = new Set(expected.map(normaliseMethodName).filter(Boolean));
  const gotSet = new Set(got.map(normaliseMethodName).filter(Boolean));
  if (expSet.size === 0 || gotSet.size === 0) return 'na';
  let matched = 0;
  for (const e of expSet) if (gotSet.has(e)) matched++;
  return matched / expSet.size >= 0.6 ? 'match' : 'mismatch';
}

export function compareDoc(
  cp: AuditFields,
  doc: AuditFields,
  fileName: string,
  docType: AuditDocType,
  checklist: AuditFieldKey[],
): DocComparison {
  const fields: FieldComparison[] = [];
  for (const key of AUDIT_FIELD_KEYS) {
    const exp = (cp as any)[key];
    const g = (doc as any)[key];
    const expected = FIELD_TYPE[key] === 'list' ? (exp || []) : (exp ?? null);
    const got = FIELD_TYPE[key] === 'list' ? (g || []) : (g ?? null);

    // Skip via checklist OR per-doc-type applicability — both produce 'na'
    // (no contribution to pass/fail counts).
    if (!checklist.includes(key) || !APPLICABLE_TYPES[key].includes(docType)) {
      fields.push({ field: key, label: AUDIT_FIELD_LABELS[key], status: 'na', expected, got });
      continue;
    }

    let status: CompareStatus;
    switch (FIELD_TYPE[key]) {
      case 'list':
        // Methods/instructional methods need name-canonicalisation so
        // "Written Exam" matches "Written Assessment - Short Answer Questions".
        if (key === 'assessment_methods' || key === 'instructional_methods') {
          status = compareMethods(expected as string[], got as string[]);
        } else {
          status = compareList(expected as string[], got as string[]);
        }
        break;
      case 'duration':
        status = compareDuration(expected as string | null, got as string | null, cp);
        break;
      default:
        // Company name is the same entity across CP/courseware even when
        // case + naming variants differ; use the lenient name comparator.
        if (key === 'company_name') {
          status = compareNameLoose(expected as string | null, got as string | null);
        } else {
          status = compareScalar(expected as string | null, got as string | null);
        }
    }
    fields.push({ field: key, label: AUDIT_FIELD_LABELS[key], status, expected, got });
  }
  const passCount = fields.filter((f) => f.status === 'match').length;
  const failCount = fields.filter((f) => f.status === 'mismatch').length;
  const missingCount = fields.filter((f) => f.status === 'missing').length;
  return { fileName, docType, fields, passCount, failCount, missingCount };
}
