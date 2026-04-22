/**
 * AP / FG / LG / ASR DOCX template filler — pure TypeScript port of
 * `scripts/fill-template.py`.
 *
 *  - Jinja2 templates (`{{ var }}`, `{% for ... %}`) rendered via `nunjucks`
 *  - DOCX zip handled via `pizzip`
 *  - Pre-processing strips Word's spell-check markers (`<w:proofErr/>`) and
 *    collapses `{{ ... }}` placeholders split across multiple `<w:r>` runs so
 *    nunjucks can find them (same root cause as the Python fix).
 *  - `company_logo` inserted via a unique marker that is swapped for a
 *    `<w:drawing>` after rendering; the image bytes are added to
 *    `word/media/` and a relationship is wired into
 *    `word/_rels/document.xml.rels`.
 */

import nunjucks from 'nunjucks';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';

export type CwDocType = 'ap' | 'asr' | 'fg' | 'lg' | 'lp';

const TEMPLATE_DIR = path.join(process.cwd(), 'public', 'templates', 'courseware');

const TEMPLATES: Record<CwDocType, string> = {
  ap: 'AP_TGS-Ref-No_Course-Title_v1.docx',
  asr: 'ASR_TGS-Ref-No_Course-Title_v1.docx',
  fg: 'FG_TGS-Ref-No_Course-Title_v1.docx',
  lg: 'LG_TGS-Ref-No_Course-Title_v1.docx',
  lp: 'LP_TGS-Ref-No_Course-Title_v1.docx',
};

const DEFAULT_LOGO_PATH = path.join(TEMPLATE_DIR, 'tertiary_logo.png');

const METHOD_ABBR: Record<string, string> = {
  'Written Assessment - Short Answer Questions': 'WA-SAQ',
  'Written Assessment - Question and Answers': 'WA(Q&A)',
  'Written Assessment (Question and Answers)': 'WA(Q&A)',
  'Written Assessment': 'WA-SAQ',
  'Written Exam': 'WA(Q&A)',
  'WA(Q&A)': 'WA(Q&A)',
  'Practical Performance': 'PP',
  'Practical Exam': 'PP',
  'Case Study': 'CS',
  'Oral Questioning': 'OQ',
  'Role Play': 'RP',
  'Oral Interview': 'OI',
  'Demonstration': 'DEM',
  'Project': 'PRJ',
  'Assignment': 'ASGN',
  'Online Test': 'OT',
};

// If the CP gave us an abbreviation but the method name actually says "Question
// and Answers", prefer the WA(Q&A) form the Streamlit reference uses.
function reconcileAbbreviation(method: string, abbr: string): string {
  const m = method.toLowerCase();
  if (/question\s*(?:and|&)\s*answer/i.test(method)) return 'WA(Q&A)';
  if (m.includes('short answer')) return 'WA-SAQ';
  return abbr;
}

const SECTOR_MAP: Record<string, { sector: string; framework: string }> = {
  ICT: { sector: 'Infocomm Technology', framework: 'ICT Skills Framework' },
  LOG: { sector: 'Logistics', framework: 'Logistics Skills Framework' },
  FIN: { sector: 'Financial Services', framework: 'Financial Services Skills Framework' },
  HR: { sector: 'Human Resource', framework: 'Human Resource Skills Framework' },
  MFG: { sector: 'Manufacturing', framework: 'Manufacturing Skills Framework' },
  BIZ: { sector: 'Business Management', framework: 'Business Management Skills Framework' },
  LPM: { sector: 'Lean & Productivity', framework: 'Lean Enterprise System Skills Framework' },
  SEC: { sector: 'Security', framework: 'Security Skills Framework' },
  CI: { sector: 'Creative Industries', framework: 'Creative Industries Skills Framework' },
  EHS: { sector: 'Environmental Services', framework: 'Environmental Services Skills Framework' },
  BIN: { sector: 'Business Innovation', framework: 'Business Innovation Skills Framework' },
  ACC: { sector: 'Accountancy', framework: 'Skills Framework for Accountancy' },
};

const LOGO_IMAGE_NAME = 'image_cw_logo.png';
const LOGO_REL_ID = 'rIdCwLogo';
const LOGO_EMU_WIDTH = 1_800_000; // 50 mm
const LOGO_EMU_HEIGHT = 1_800_000;

// ── Nunjucks env — no autoescape (we pre-escape strings as XML) ──────────────
const njk = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

// Templates use `| join(', ')` on values that may legitimately be a string,
// an array, or undefined. The built-in `join` filter crashes on strings, so
// override with a permissive version.
njk.addFilter('join', (value: any, sep: any = ',') => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).join(String(sep));
  return String(value);
});

// docxtpl templates use Python-style list mutation — e.g.
//   {%- set all_k_statements = [] -%}
//   {{ all_k_statements.append((k, unit)) or '' }}     <-- side-effect only
//   {%- set ks = ks.append(k.K_number) %}              <-- chained mutation
//
// Strategy:
//   1. Monkey-patch `Array.prototype.append` to push AND return `this` so
//      `set ks = ks.append(x)` keeps `ks` as the array across iterations.
//   2. Rewrite `{{ x.append(...) or '' }}` → `{% set __cw_void = x.append(...) %}`
//      (evaluates the side-effect, produces no output). Without this, the
//      truthy return value would spray `[object Object]` into the doc; but
//      simply *stripping* the call leaves the local accumulator empty and
//      kills the Knowledge / Abilities matrices.
//   3. Swap `(a, b)` tuple-literals for `[a, b]` so Nunjucks can parse them.
const TUPLE_ARG_RE = /\.append\(\s*\(([^)]*)\)\s*\)/g;
const APPEND_OR_EMPTY_RE =
  /\{\{\s*([a-zA-Z_][\w.]*\.append\([^}]*\))\s*or\s*['"][^'"]*['"]\s*\}\}/g;

function renderWithDocxtplCompat(xml: string, ctx: Record<string, any>): string {
  const prevAppend = (Array.prototype as any).append;
  // Python-style string methods used by docxtpl templates (e.g. LP_TGS uses
  // `session.instruction_title.startswith("Activity:")`). Add lowercased
  // aliases on String.prototype so Nunjucks can resolve them.
  const prevStartswith = (String.prototype as any).startswith;
  const prevEndswith = (String.prototype as any).endswith;
  (String.prototype as any).startswith = function (this: string, s: string) {
    return this.startsWith(s);
  };
  (String.prototype as any).endswith = function (this: string, s: string) {
    return this.endsWith(s);
  };
  let rewritten = xml.replace(APPEND_OR_EMPTY_RE, (_m, call: string) => `{% set __cw_void = ${call} %}`);
  rewritten = rewritten.replace(TUPLE_ARG_RE, (_m, inner: string) => `.append([${inner}])`);
  Object.defineProperty(Array.prototype, 'append', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: function (this: any[], item: any) {
      this.push(item);
      return this;
    },
  });
  try {
    return njk.renderString(rewritten, ctx);
  } finally {
    if (prevAppend === undefined) delete (Array.prototype as any).append;
    else (Array.prototype as any).append = prevAppend;
    if (prevStartswith === undefined) delete (String.prototype as any).startswith;
    else (String.prototype as any).startswith = prevStartswith;
    if (prevEndswith === undefined) delete (String.prototype as any).endswith;
    else (String.prototype as any).endswith = prevEndswith;
  }
}

// ── XML helpers ──────────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeContext<T>(value: T): T {
  if (typeof value === 'string') return escapeXml(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => escapeContext(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = escapeContext((value as Record<string, unknown>)[k]);
    }
    return out as unknown as T;
  }
  return value;
}

const PROOF_ERR_RE = /<w:proofErr[^/]*\/>/g;
// Non-greedy match for a `{{ ... }}` (and `{% ... %}`) that may span runs and
// — in rare Word artefacts — paragraph boundaries. We extract only the inner
// text and emit a single `<w:t>` element containing the clean tag.
// Match `<w:t>PRE{{ inner }}POST</w:t>` where `{{ inner }}` may itself span
// multiple `<w:r>` runs. Pre/post are literal text chunks before/after the
// tag inside the same `<w:t>` element on either end of the span.
const XML_TAG_RE = /<[^>]+>/g;

// Word sometimes splits `}}` (or `{{`) into two separate `<w:t>` elements
// so a naive `\}\}` never sees the pair. Permit XML tags between the two
// braces. Same for `{{`.
const VAR_LOOSE_SPAN_RE =
  /\{((?:<[^>]+>)*)\{((?:(?!\{\{|\}\}|<\/w:p>)[\s\S])*?)\}((?:<[^>]+>)*)\}/g;
const STMT_LOOSE_SPAN_RE =
  /\{((?:<[^>]+>)*)%((?:(?!\{%|%\}|<\/w:p>)[\s\S])*?)%((?:<[^>]+>)*)\}/g;

// Normalise smart quotes / en-dashes / stray whitespace INSIDE Jinja tags.
// The AP template (and some FG/ASR sections) contain curly quotes like
// `'RP'` and `"SAQ"` which Nunjucks can't parse as string delimiters —
// every `{% if %}` that uses them evaluates unpredictably, leaving either
// junk content or blank tables/pages. The template also has typos like
// `mtd.Assessment _Method` (stray space before `_`) inside variable names,
// which Nunjucks treats as `mtd.Assessment` (missing field) followed by
// garbage — making the whole placeholder render empty. We only touch
// characters *inside* `{%...%}` and `{{...}}`; document text is untouched.
function normaliseTagInternals(xml: string): string {
  const fix = (s: string) => s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")        // curly single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')        // curly double quotes → "
    .replace(/[\u2013\u2014\u2212]/g, '-')              // en/em dash → -
    .replace(/(\w)\s+_(\w)/g, '$1_$2')                  // "Assessment _Method" → "Assessment_Method"
    .replace(/\.\s+([A-Za-z_])/g, '.$1');               // "mtd. Method" → "mtd.Method"
  let out = xml.replace(/\{%([\s\S]*?)%\}/g, (_m, inner) => `{%${fix(inner)}%}`);
  out = out.replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner) => `{{${fix(inner)}}}`);
  return out;
}

function normaliseTemplateXml(xml: string, docType?: CwDocType): string {
  let out = xml.replace(PROOF_ERR_RE, '');
  out = out.replace(VAR_LOOSE_SPAN_RE, (_m, openTags: string, middle: string) => {
    const inner = middle.includes('<') ? middle.replace(XML_TAG_RE, '') : middle;
    void openTags;
    return `{{${inner}}}`;
  });
  out = out.replace(STMT_LOOSE_SPAN_RE, (_m, openTags: string, middle: string) => {
    const inner = middle.includes('<') ? middle.replace(XML_TAG_RE, '') : middle;
    void openTags;
    return `{%${inner}%}`;
  });
  out = normaliseTagInternals(out);
  // AP template has complex inline `{% set %}` chains nested in runs that
  // break when unwrapped at paragraph level. Keep AP's row/cell-only unwrap.
  out = unwrapTagOnlyContainers(out, docType !== 'ap');
  return out;
}

/**
 * docxtpl auto-detects `{% for %}` / `{% endfor %}` tags placed on their own
 * paragraph or table row and REMOVES the surrounding wrapper so iterating
 * doesn't leave an empty row/paragraph between entries. Nunjucks doesn't do
 * this — so without this helper, every iteration of a table row loop leaves
 * a blank row (from the `{% for %}` row itself) between data rows.
 *
 * We detect `<w:tr>` and `<w:p>` elements whose visible text is only Jinja
 * block tags (possibly multiple), and replace the wrapper with the bare tags.
 */
const TR_BLOCK_RE = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
const TC_BLOCK_RE = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
const TAG_TEXT_RE = /<[^>]+>/g;

// Only `{% block %}` tags should trigger unwrapping. A paragraph whose only
// visible content is `{{ var }}` will render to real text after nunjucks —
// that text MUST stay wrapped in a `<w:p>` inside its `<w:tc>`, otherwise the
// DOCX is invalid (Word refuses to open it: "can't open the file").
function isOnlyBlockTags(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  if (!trimmed.includes('{%')) return false;       // must have at least one block tag
  if (/\{\{/.test(trimmed)) return false;          // no variable output allowed
  // Sequence of `{% ... %}` tags, where each tag's interior has no nested braces.
  return /^(?:\{%(?:(?!\{%|%\})[\s\S])*?%\}\s*)+$/.test(trimmed);
}

// Add `<w:keepNext/>` to every Heading paragraph so Word doesn't strand the
// heading alone on the previous page when the table/content beneath it
// can't fit. Mirrors the visual layout the Streamlit reference uses.
function keepHeadingsWithNext(xml: string): string {
  return xml.replace(
    /<w:pPr>([\s\S]*?<w:pStyle\s+w:val="Heading\d"\/>[\s\S]*?)<\/w:pPr>/g,
    (match, inner: string) => {
      if (inner.includes('<w:keepNext')) return match;
      return `<w:pPr><w:keepNext/>${inner}</w:pPr>`;
    },
  );
}

// Paragraphs that contain ONLY Jinja block tags (no nested `<w:p>`, no
// variables, no real text). Safe to unwrap — the block tag stays, the
// paragraph wrapper is removed so the rendered doc doesn't accumulate
// empty paragraphs between iteration points.
const P_ONLY_TAGS_RE = /<w:p\b[^>]*>((?:(?!<w:p\b)[\s\S])*?)<\/w:p>/g;

function unwrapTagOnlyContainers(xml: string, unwrapParagraphs = true): string {
  // 1. Unwrap TABLE ROWS whose only content is Jinja block tags.
  let out = xml.replace(TR_BLOCK_RE, (match, inner) => {
    const text = inner.replace(TAG_TEXT_RE, '').replace(/\s+/g, ' ').trim();
    return isOnlyBlockTags(text) ? text : match;
  });
  // 2. Unwrap TABLE CELLS whose only content is Jinja block tags.
  out = out.replace(TC_BLOCK_RE, (match, inner) => {
    const text = inner.replace(TAG_TEXT_RE, '').replace(/\s+/g, ' ').trim();
    return isOnlyBlockTags(text) ? text : match;
  });
  // 3. Unwrap PARAGRAPHS whose only content is Jinja block tags (opt-in).
  if (unwrapParagraphs) {
    out = out.replace(P_ONLY_TAGS_RE, (match, inner) => {
      const text = inner.replace(TAG_TEXT_RE, '').replace(/\s+/g, ' ').trim();
      return isOnlyBlockTags(text) ? text : match;
    });
  }
  // 4. Re-pad empty cells — OOXML requires `<w:tc>` to contain ≥ 1 `<w:p>`.
  out = out.replace(/<w:tc\b([^>]*)>([\s\S]*?)<\/w:tc>/g, (match, attrs, inner) => {
    if (/<w:p\b/.test(inner)) return match;
    const tcPrMatch = inner.match(/^([\s\S]*?<\/w:tcPr>)?([\s\S]*)$/);
    const head = tcPrMatch?.[1] || '';
    const rest = tcPrMatch?.[2] || inner;
    return `<w:tc${attrs}>${head}<w:p/>${rest}</w:tc>`;
  });
  return out;
}

// ── Helpers matching Python build_context() ──────────────────────────────────
function getMethodAbbr(method: string): string {
  if (!method) return '';
  if (METHOD_ABBR[method]) return METHOD_ABBR[method];
  for (const [k, v] of Object.entries(METHOD_ABBR)) {
    if (method.toLowerCase().includes(k.toLowerCase())) return v;
  }
  if (method.length <= 6 && method === method.toUpperCase()) return method;
  return method
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

function getSectorInfo(tscCode: string): { sector: string; framework: string; level: string } {
  if (!tscCode) return { sector: '', framework: '', level: '' };
  const prefix = tscCode.split('-')[0].toUpperCase();
  const base = SECTOR_MAP[prefix] || { sector: '', framework: '' };
  const levelMatch = tscCode.match(/-(\d+)\./);
  const level = levelMatch ? `Level ${levelMatch[1]}` : '';
  return { ...base, level };
}

type Dict = Record<string, any>;

function pick(data: Dict, ...keys: string[]): any {
  for (const k of keys) {
    const v = data?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

function buildContext(data: Dict, _docType: CwDocType): Dict {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleString('en-US', { month: 'short' });
  const effectiveDate = `${day} ${month} ${now.getFullYear()}`;

  const tscCode = pick(data, 'TSC_Code', 'tscCode');
  const sectorInfo = getSectorInfo(String(tscCode));

  const camelLus: Dict[] = (data.learningUnits as Dict[]) || [];
  const pascalLus: Dict[] = (data.Learning_Units as Dict[]) || [];
  const sourceLus = pascalLus.length ? pascalLus : camelLus;

  const processedLus: Dict[] = [];
  sourceLus.forEach((lu, idx) => {
    const methods: string[] = (lu.Assessment_Methods || lu.assessmentMethods || []) as string[];
    const methodAbbrs = methods
      .map((m) => reconcileAbbreviation(m, getMethodAbbr(m) || m))
      .filter(Boolean);

    const loFull = String(lu.LO || lu.learningOutcome || '');
    const loLabelMatch = loFull.match(/(E?LO\d+)/);
    const loLabel = loLabelMatch ? loLabelMatch[1] : `LO${idx + 1}`;

    const topics: Dict[] = (lu.Topics || lu.topics || []) as Dict[];
    const kStatements: Dict[] = (lu.K_numbering_description || lu.kStatements || []) as Dict[];
    const aStatements: Dict[] = (lu.A_numbering_description || lu.aStatements || []) as Dict[];

    processedLus.push({
      LU_Number: lu.LU_Number || `LU${idx + 1}`,
      LO_Number: lu.LO_Number || `LO${idx + 1}`,
      LU_Title: lu.LU_Title || lu.luTitle || '',
      // The docxtpl reference stores `unit.LO` as just the label ("ELO1") —
      // the Streamlit ASR / AP templates render `{{ unit.LO }}` expecting
      // that short form. Keep full text accessible as LO_Full for callers
      // that want it.
      LO: loLabel,
      LO_Full: loFull,
      LO_Label: loLabel,
      Topics: topics.map((t) => ({
        Topic_Title: t.Topic_Title || t.title || '',
        Bullet_Points: t.Bullet_Points || t.bulletPoints || [],
      })),
      K_numbering_description: kStatements.map((k) => ({
        K_number: k.K_number || k.id || '',
        Description: k.Description || k.description || '',
      })),
      A_numbering_description: aStatements.map((a) => ({
        A_number: a.A_number || a.id || '',
        Description: a.Description || a.description || '',
      })),
      Assessment_Methods: methodAbbrs,
      Assessment_Methods_Full: methods,
      Assessment_Methods_Abbr: methodAbbrs.join(', '),
      Instructional_Methods: lu.Instructional_Methods || lu.instructionalMethods || [],
    });
  });

  const amDetailsSrc: Dict[] =
    (data.Assessment_Methods_Details as Dict[]) ||
    (data.assessmentMethodsDetails as Dict[]) ||
    [];

  const allMethodAbbrs = Array.from(
    new Set(
      amDetailsSrc.map((am) =>
        String(
          am.Method_Abbreviation ||
            am.abbreviation ||
            getMethodAbbr(am.Assessment_Method || am.method || ''),
        ),
      ),
    ),
  ).filter(Boolean);

  for (const lu of processedLus) {
    if (!lu.Assessment_Methods || lu.Assessment_Methods.length === 0) {
      lu.Assessment_Methods = allMethodAbbrs;
    }
  }

  // The template iterates Evidence/Submission/Marking_Process with
  // `{% for item in ... %}` and renders each item as `{{ item }}`.
  //
  // The Streamlit reference renders `{LO, Evidence}` evidence pairs as Python
  // dict literals — `{'LO': 'ELO1', 'Evidence': '...'}` — because Python's
  // docxtpl iteration falls back to `str(dict)` for that shape. Match that
  // exactly so the docs are byte-equivalent. Plain strings stay as-is.
  const formatPythonDictLiteral = (obj: Record<string, any>): string => {
    const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const parts = Object.entries(obj).map(([k, v]) => {
      const keyStr = `'${escape(String(k))}'`;
      if (v === null || v === undefined) return `${keyStr}: None`;
      if (typeof v === 'string') return `${keyStr}: '${escape(v)}'`;
      if (typeof v === 'number' || typeof v === 'boolean') return `${keyStr}: ${v}`;
      return `${keyStr}: ${JSON.stringify(v)}`;
    });
    return `{${parts.join(', ')}}`;
  };
  const toStringList = (v: any): string[] => {
    if (v === null || v === undefined || v === '') return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') return formatPythonDictLiteral(item);
        return String(item);
      })
      .filter((s) => s.length > 0);
  };

  const assessmentMethodsDetails = amDetailsSrc.map((am) => {
    const method = String(am.Assessment_Method || am.method || '');
    const rawAbbr = am.Method_Abbreviation || am.abbreviation || getMethodAbbr(method);
    const abbr = reconcileAbbreviation(method, rawAbbr);
    const ratioRaw = am.Assessor_to_Candidate_Ratio || [];
    return {
      Assessment_Method: method,
      Method_Abbreviation: abbr,
      Total_Delivery_Hours: am.Total_Delivery_Hours || am.totalHours || '',
      Assessor_to_Candidate_Ratio: Array.isArray(ratioRaw) ? ratioRaw : [ratioRaw].filter(Boolean),
      Evidence: toStringList(am.Evidence),
      Submission: toStringList(am.Submission),
      Marking_Process: toStringList(am.Marking_Process),
      Retention_Period: typeof am.Retention_Period === 'string' ? am.Retention_Period : '',
    };
  });

  return {
    Course_Title: pick(data, 'Course_Title', 'courseTitle'),
    TSC_Code: tscCode,
    TSC_Title: pick(data, 'TSC_Title', 'tscTitle'),
    TSC_Category: sectorInfo.sector || pick(data, 'TSC_Category', 'TSC_Sector'),
    TSC_Sector: sectorInfo.sector || pick(data, 'TSC_Sector', 'TSC_Category'),
    TSC_Sector_Abbr: sectorInfo.framework || pick(data, 'Skills_Framework'),
    Skills_Framework: sectorInfo.framework || pick(data, 'Skills_Framework'),
    Proficiency_Level: sectorInfo.level || pick(data, 'Proficiency_Level'),
    TSC_Description: pick(data, 'TSC_Description', 'courseOverview', 'Course_Overview'),
    Proficiency_Description: pick(
      data,
      'Proficiency_Description',
      'TSC_Description',
      'courseOverview',
      'Course_Overview',
    ),
    Course_Overview: pick(data, 'Course_Overview', 'courseOverview'),
    LO_Description: pick(data, 'LO_Description'),
    TGS_Ref_No: pick(data, 'TGS_Ref_No', 'tgsRefNo'),
    Total_Training_Hours: pick(data, 'Total_Training_Hours', 'totalTrainingHours'),
    Total_Assessment_Hours: pick(data, 'Total_Assessment_Hours', 'totalAssessmentHours'),
    Total_Course_Duration_Hours: pick(data, 'Total_Course_Duration_Hours'),
    Name_of_Organisation: pick(data, 'Name_of_Organisation', 'organisationName'),
    UEN: pick(data, 'UEN') || '201200696W',
    Rev_No: '1.0',
    Effective_Date: effectiveDate,
    Date: effectiveDate,
    Year: String(now.getFullYear()),
    Author: '',
    Reviewed_By: '',
    Approved_By: '',
    // The LP template iterates `{% for day in lesson_plan %}`. Pull through
    // the caller's value when present (an array of day objects); fall back
    // to empty string for templates that just reference it as text.
    lesson_plan: Array.isArray(data.lesson_plan) ? data.lesson_plan : '',
    company_logo: '',
    Learning_Units: processedLus,
    Assessment_Methods_Details: assessmentMethodsDetails,
    // Pre-computed flat aggregates the AP template's Knowledge/Ability matrix
    // expects (docxtpl accumulates them via `.append` / `set` tricks which
    // Nunjucks can't evaluate safely — see `renderWithDocxtplCompat`).
    all_k_statements: processedLus.flatMap((lu) =>
      (lu.K_numbering_description || []).map((k: Dict) => [k, lu]),
    ),
    all_a_statements: processedLus.flatMap((lu) =>
      (lu.A_numbering_description || []).map((a: Dict) => [a, lu]),
    ),
    ks: [] as any[],
    as: [] as any[],
  };
}

// ── Logo insertion ───────────────────────────────────────────────────────────
function buildLogoDrawingXml(relId: string, widthEmu: number, heightEmu: number): string {
  return (
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1001" name="company_logo"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="1001" name="company_logo"/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>`
  );
}

function installLogoInZip(zip: PizZip, logoPath: string): string {
  if (!fs.existsSync(logoPath)) return '';
  const logoBytes = fs.readFileSync(logoPath);
  const mediaPath = `word/media/${LOGO_IMAGE_NAME}`;
  zip.file(mediaPath, logoBytes);

  // Ensure [Content_Types].xml has PNG default
  const ctKey = '[Content_Types].xml';
  const ctFile = zip.file(ctKey);
  if (ctFile) {
    let ct = ctFile.asText();
    if (!/<Default\s+Extension="png"/i.test(ct)) {
      ct = ct.replace(
        '</Types>',
        `<Default Extension="png" ContentType="image/png"/></Types>`,
      );
      zip.file(ctKey, ct);
    }
  }

  // Add relationship in word/_rels/document.xml.rels
  const relsKey = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsKey);
  if (relsFile) {
    let rels = relsFile.asText();
    if (!rels.includes(`Id="${LOGO_REL_ID}"`)) {
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${LOGO_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${LOGO_IMAGE_NAME}"/></Relationships>`,
      );
      zip.file(relsKey, rels);
    }
  }

  return LOGO_REL_ID;
}

// Blank-page / empty-paragraph cleanup intentionally omitted — the Python
// version used python-docx to walk structured elements. Implementing the same
// via raw regex on XML is error-prone (non-greedy backtracking bleeds past
// paragraph boundaries and eats real content). The rendered deck looks
// nearly identical without it; revisit with a proper XML walker if needed.

// ── Main ─────────────────────────────────────────────────────────────────────
export interface FillTemplateOptions {
  logoPath?: string;
}

export function fillTemplate(
  docType: CwDocType,
  rawContext: Dict,
  options: FillTemplateOptions = {},
): Buffer {
  const templateFile = TEMPLATES[docType];
  if (!templateFile) throw new Error(`Unknown doc type: ${docType}`);
  const templatePath = path.join(TEMPLATE_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const zip = new PizZip(fs.readFileSync(templatePath));

  // Install logo into the zip (media + content type + relationship)
  const logoPath = options.logoPath ?? DEFAULT_LOGO_PATH;
  const relId = installLogoInZip(zip, logoPath);

  // Build context. We don't pass company_logo through nunjucks — it's swapped
  // out at XML level (replacing the whole run) so the `<w:drawing>` never
  // ends up inside a `<w:t>` text element (which would be malformed XML).
  const ctx = buildContext(rawContext, docType);
  ctx.company_logo = '';
  const escaped = escapeContext(ctx);

  const xmlParts = Object.keys(zip.files).filter(
    (name) =>
      name === 'word/document.xml' ||
      (name.startsWith('word/header') && name.endsWith('.xml')) ||
      (name.startsWith('word/footer') && name.endsWith('.xml')),
  );

  const logoDrawingXml = relId
    ? buildLogoDrawingXml(relId, LOGO_EMU_WIDTH, LOGO_EMU_HEIGHT)
    : '';

  if (process.env.CW_DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[cw-fill-template] ctx keys:', Object.keys(escaped).sort());
    // eslint-disable-next-line no-console
    console.log(
      '[cw-fill-template] critical fields:',
      JSON.stringify({
        Course_Title: (escaped as Dict).Course_Title,
        TGS_Ref_No: (escaped as Dict).TGS_Ref_No,
        Name_of_Organisation: (escaped as Dict).Name_of_Organisation,
        lu_count: (escaped as Dict).Learning_Units?.length,
      }),
    );
  }

  const logoRunRe = /<w:r\b[^>]*>[\s\S]*?<w:t[^>]*>\{\{\s*company_logo\s*\}\}<\/w:t>[\s\S]*?<\/w:r>/g;

  for (const name of xmlParts) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = file.asText();
    xml = normaliseTemplateXml(xml, docType);
    if (logoDrawingXml) {
      // Swap the entire `<w:r>...{{company_logo}}...</w:r>` run for a run
      // containing the drawing element. Must happen BEFORE nunjucks so the
      // drawing XML isn't trapped inside a `<w:t>` text element.
      xml = xml.replace(logoRunRe, `<w:r>${logoDrawingXml}</w:r>`);
    } else {
      // No logo — just strip the placeholder so nunjucks doesn't leave `{{ }}` visible.
      xml = xml.replace(logoRunRe, '');
    }
    xml = renderWithDocxtplCompat(xml, escaped);
    if (name === 'word/document.xml') xml = keepHeadingsWithNext(xml);
    zip.file(name, xml);
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
