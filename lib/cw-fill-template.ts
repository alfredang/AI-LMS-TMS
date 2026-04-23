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
  // LP_template_v2.docx ships the cover + Version Control Record only; the
  // per-day schedule tables are appended programmatically by lib/cw-lesson-plan.ts
  // so the output mirrors the Streamlit reference structure exactly.
  lp: 'LP_template_v2.docx',
};

const DEFAULT_LOGO_PATH = path.join(TEMPLATE_DIR, 'tertiary_logo.png');

// Mirror of Python METHOD_ABBR in scripts/fill-template.py. Every "Written
// Assessment / Exam" variant maps to WA-SAQ — that is the label the Streamlit
// reference actually emits, and the ASR summary-table `√` / `-` logic in the
// templates hinges on this matching exactly.
const METHOD_ABBR: Record<string, string> = {
  'Written Assessment - Short Answer Questions': 'WA-SAQ',
  'Written Assessment - Question and Answers': 'WA-SAQ',
  'Written Assessment (Question and Answers)': 'WA-SAQ',
  'Written Assessment': 'WA-SAQ',
  'Written Exam': 'WA-SAQ',
  'WA(Q&A)': 'WA-SAQ',
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

// Dumb-but-reliable: delete any empty <w:p>...</w:p> that sits immediately
// before a <w:tbl>. Runs repeatedly so chains of empty paragraphs before
// a table all get removed. This makes any heading+table pair adjacent in
// the XML, so Word cannot split them across pages.
function glueVersionControlHeadingToTable(xml: string): string {
  const pattern = /<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>(?=\s*<w:tbl\b)/g;
  let prev = '';
  let out = xml;
  // Iterate until the regex stops changing the doc — successive passes
  // expose newly-adjacent empty paragraphs.
  while (out !== prev) {
    prev = out;
    out = out.replace(pattern, (match) => {
      const text = match.replace(/<[^>]+>/g, '').trim();
      const hasDrawing = /<w:drawing\b|<w:pict\b/.test(match);
      const hasPageBreak = /<w:br\b[^>]*w:type\s*=\s*"page"[^>]*\/?>/.test(match);
      return !text && !hasDrawing && !hasPageBreak ? '' : match;
    });
  }
  return out;
}

function spliceHeadingToTable(xml: string, pStart: number, pEnd: number): string {
  // Find the next <w:tbl> after the heading
  const tblIdx = xml.indexOf('<w:tbl', pEnd);
  if (tblIdx < 0) return xml;
  // Everything between pEnd and tblIdx is fair game to delete IF it's only
  // empty paragraphs (text-empty, no drawing, no page break).
  const between = xml.substring(pEnd, tblIdx);
  // Strip paragraphs, keep any non-paragraph content (shouldn't be any, but be safe).
  const pattern = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const cleaned = between.replace(pattern, (m) => {
    const text = m.replace(/<[^>]+>/g, '').trim();
    const hasDrawing = /<w:drawing\b|<w:pict\b/.test(m);
    const hasPageBreak = /<w:br\b[^>]*w:type\s*=\s*"page"[^>]*\/?>/.test(m);
    if (!text && !hasDrawing && !hasPageBreak) return '';
    return m;
  });
  return xml.substring(0, pEnd) + cleaned + xml.substring(tblIdx);
}

// Remove empty paragraphs that sit between a Heading paragraph and the
// immediately-following table. Word's page break logic otherwise puts the
// heading at the bottom of a page, the empty paragraph right below it,
// and pushes the (too-big-to-fit) table to the next page — leaving a
// huge gap on the previous page. Deleting the separator paragraphs makes
// the heading and table adjacent, so Word always paginates them together.
function dropEmptyParagraphsBetweenHeadingAndTable(xml: string): string {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return xml;
  const body = bodyMatch[1];
  const items = splitBodyTopLevel(body);
  const pieces = items.map((it) => body.substring(it.start, it.end));
  const isHeading = (p: string) => /<w:pStyle\s+w:val="Heading\d"\/>/.test(p);
  const isEmpty = (p: string) =>
    !extractParaTextContent(p).trim() && !paraHasDrawing(p) && !paraHasPageBreak(p);
  const keep: boolean[] = pieces.map(() => true);

  for (let i = 0; i < items.length; i++) {
    if (items[i].tag !== 'p' || !isHeading(pieces[i])) continue;

    // Walk forward: empty paragraphs we might drop, then check for a table.
    const candidates: number[] = [];
    let j = i + 1;
    while (j < items.length && items[j].tag === 'p' && isEmpty(pieces[j])) {
      candidates.push(j);
      j++;
    }
    if (j < items.length && items[j].tag === 'tbl' && candidates.length > 0) {
      for (const c of candidates) keep[c] = false;
    }
  }

  if (keep.every(Boolean)) return xml;

  let newBody = '';
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    newBody += body.substring(cursor, items[i].start);
    if (keep[i]) newBody += pieces[i];
    cursor = items[i].end;
  }
  newBody += body.substring(cursor);
  const bodyAttrs = bodyMatch[0].match(/<w:body(\b[^>]*)>/)?.[1] ?? '';
  return xml.replace(bodyMatch[0], `<w:body${bodyAttrs}>${newBody}</w:body>`);
}

// Word's `<w:keepNext/>` only binds a paragraph to the IMMEDIATE next
// element. A FG/LG heading followed by an empty paragraph and then a
// table therefore keeps the heading with the empty paragraph but lets
// the table drift to the next page on its own.
//
// Propagate `<w:keepNext/>` forward through empty paragraphs until we
// hit a non-empty paragraph or a table, so the whole heading-to-table
// chain stays together on one page.
function propagateKeepNextToEmptyParagraphs(xml: string): string {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return xml;
  const body = bodyMatch[1];
  const items = splitBodyTopLevel(body);
  const pieces = items.map((it) => body.substring(it.start, it.end));
  const hasKeepNext = (p: string) => /<w:keepNext\s*\/>/.test(p);
  const paraIsEmpty = (p: string) =>
    !extractParaTextContent(p).trim() && !paraHasDrawing(p) && !paraHasPageBreak(p);

  const injectKeepNext = (p: string): string => {
    if (hasKeepNext(p)) return p;
    if (/<w:pPr>/.test(p)) {
      return p.replace(/<w:pPr>/, '<w:pPr><w:keepNext/>');
    }
    // Paragraph has no pPr — add one right after the <w:p ...> open tag.
    return p.replace(/<w:p\b([^>]*)>/, '<w:p$1><w:pPr><w:keepNext/></w:pPr>');
  };

  let changed = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].tag !== 'p' || !hasKeepNext(pieces[i])) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].tag === 'tbl') break; // table reached — chain terminates cleanly
      if (items[j].tag !== 'p') break;
      if (!paraIsEmpty(pieces[j])) break; // non-empty paragraph — chain should not extend past it
      const next = injectKeepNext(pieces[j]);
      if (next !== pieces[j]) {
        pieces[j] = next;
        changed = true;
      }
    }
  }
  if (!changed) return xml;

  let newBody = '';
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    newBody += body.substring(cursor, items[i].start);
    newBody += pieces[i];
    cursor = items[i].end;
  }
  newBody += body.substring(cursor);
  const bodyAttrs = bodyMatch[0].match(/<w:body(\b[^>]*)>/)?.[1] ?? '';
  return xml.replace(bodyMatch[0], `<w:body${bodyAttrs}>${newBody}</w:body>`);
}

// Guarantee the "Course Overview" Heading1 starts on its own page after the
// Document Version Control table. We walk top-level body paragraphs one at
// a time (NOT a regex — the previous regex matched across paragraph
// boundaries and polluted the preceding empty paragraph's pPr with
// <w:pageBreakBefore/>, which broke pagination of the version control
// heading+table pair).
function forceCourseOverviewPageBreak(xml: string): string {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return xml;
  const body = bodyMatch[1];
  const items = splitBodyTopLevel(body);
  const pieces = items.map((it) => body.substring(it.start, it.end));
  let changed = false;

  for (let i = 0; i < items.length; i++) {
    if (items[i].tag !== 'p') continue;
    const p = pieces[i];
    // Must be a Heading1 paragraph (pStyle in pPr).
    if (!/<w:pStyle\s+w:val="Heading1"\/>/.test(p)) continue;
    // Must have visible text starting with "Course Overview".
    const text = extractParaTextContent(p).replace(/\s+/g, ' ').trim();
    if (!/^Course Overview\b/i.test(text)) continue;
    // Skip if already has pageBreakBefore.
    if (/<w:pageBreakBefore/.test(p)) continue;
    // Inject <w:pageBreakBefore/> at the start of the pPr.
    pieces[i] = p.replace(/<w:pPr>/, '<w:pPr><w:pageBreakBefore/>');
    changed = true;
  }

  if (!changed) return xml;

  let newBody = '';
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    newBody += body.substring(cursor, items[i].start);
    newBody += pieces[i];
    cursor = items[i].end;
  }
  newBody += body.substring(cursor);
  const bodyAttrs = bodyMatch[0].match(/<w:body(\b[^>]*)>/)?.[1] ?? '';
  return xml.replace(bodyMatch[0], `<w:body${bodyAttrs}>${newBody}</w:body>`);
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

// ── Data cleanup to match Streamlit CP Interpreter output ───────────────────
// These normalisations exist because the Streamlit `cp_interpretation.md`
// prompt produces clean fields directly (LU titles prefixed with "LUx:",
// K/A descriptions without the trailing TSC reference code, assessment
// method names without "Others:" etc.). Our TS extraction carries those
// artefacts through, so we strip them at build-context time.

const TSC_CODE_SUFFIX_RE = /\s*\(\s*[A-Z]{2,5}(?:-[A-Z0-9]{2,6}){1,3}-\d+\.\d+\s*\)\s*$/;

function stripTscCodeSuffix(text: string): string {
  if (!text) return '';
  return String(text).replace(TSC_CODE_SUFFIX_RE, '').trim();
}

function stripOthersPrefix(text: string): string {
  if (!text) return '';
  return String(text).replace(/^\s*Others\s*:\s*/i, '').trim();
}

// Ensure an LU title displays as "LU{n}: Title" — matches Streamlit's
// cp_interpretation.md requirement. Leaves existing "LU{n}" / "LU{n}:" prefixes
// alone; otherwise prepends.
function ensureLuPrefix(title: string, index: number): string {
  const t = String(title || '').trim();
  if (!t) return `LU${index + 1}`;
  if (/^LU\s*\d+\s*[:\s]/i.test(t) || /^LU\s*\d+$/i.test(t)) return t;
  return `LU${index + 1}: ${t}`;
}

// Strip the K/A statements parenthetical some CP extractors append to topic
// titles (e.g. "Business Requirements Analysis (K2, A1)"). The Streamlit
// template renders the title as a sub-heading, not a description, so the
// trailing `(Kx, Ay)` visually clutters it.
function stripTopicCodesSuffix(title: string): string {
  if (!title) return '';
  return String(title)
    .replace(/\s*\(\s*(?:[KA]\d+(?:\s*,\s*)?)+\s*\)\s*$/, '')
    .replace(/^\s*Topic\s+\d+\s*:\s*/i, '')
    .trim();
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
    const methodAbbrs = methods.map((m) => getMethodAbbr(m)).filter(Boolean);

    const loFull = String(lu.LO || lu.learningOutcome || '');
    const loLabelMatch = loFull.match(/(E?LO\d+)/);
    const loLabel = loLabelMatch ? loLabelMatch[1] : `LO${idx + 1}`;

    const topics: Dict[] = (lu.Topics || lu.topics || []) as Dict[];
    const kStatements: Dict[] = (lu.K_numbering_description || lu.kStatements || []) as Dict[];
    const aStatements: Dict[] = (lu.A_numbering_description || lu.aStatements || []) as Dict[];

    const luTitleRaw = String(lu.LU_Title || lu.luTitle || '').trim();
    const luTitle = ensureLuPrefix(luTitleRaw, idx);

    processedLus.push({
      LU_Number: lu.LU_Number || `LU${idx + 1}`,
      LO_Number: lu.LO_Number || `LO${idx + 1}`,
      LU_Title: luTitle,
      // The docxtpl reference stores `unit.LO` as just the label ("ELO1") —
      // the Streamlit ASR / AP templates render `{{ unit.LO }}` expecting
      // that short form. Keep full text accessible as LO_Full for callers
      // that want it.
      LO: loLabel,
      LO_Full: loFull,
      LO_Label: loLabel,
      Topics: topics.map((t) => ({
        Topic_Title: stripTopicCodesSuffix(t.Topic_Title || t.title || ''),
        Bullet_Points: t.Bullet_Points || t.bulletPoints || [],
      })),
      K_numbering_description: kStatements.map((k) => ({
        K_number: stripTscCodeSuffix(String(k.K_number || k.id || '')),
        Description: stripTscCodeSuffix(String(k.Description || k.description || '')),
      })),
      A_numbering_description: aStatements.map((a) => ({
        A_number: stripTscCodeSuffix(String(a.A_number || a.id || '')),
        Description: stripTscCodeSuffix(String(a.Description || a.description || '')),
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

  // Mirror Python build_context (fill-template.py ~L426-437): if a LU has no
  // methods, assign all methods from Assessment_Methods_Details, THEN normalise
  // every entry to an abbreviation so the template's matrix logic
  // (`if mtd.Method_Abbreviation in unit.Assessment_Methods`) matches.
  for (const lu of processedLus) {
    if (!lu.Assessment_Methods || lu.Assessment_Methods.length === 0) {
      lu.Assessment_Methods = allMethodAbbrs.slice();
    }
    const fixed: string[] = [];
    for (const m of lu.Assessment_Methods) {
      const abbr = String(m).length > 6 ? getMethodAbbr(String(m)) : String(m);
      if (abbr) fixed.push(abbr);
    }
    lu.Assessment_Methods = Array.from(new Set(fixed));
    lu.Assessment_Methods_Abbr = lu.Assessment_Methods.join(', ');
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
    const method = stripOthersPrefix(String(am.Assessment_Method || am.method || ''));
    const abbr = String(am.Method_Abbreviation || am.abbreviation || getMethodAbbr(method));
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

// Blank-page / empty-paragraph cleanup — port of the python-docx post-process
// in scripts/fill-template.py (~L523-586). Two passes:
//   1. If a paragraph contains a `<w:br w:type="page"/>` and the next 7
//      siblings inside <w:body> are all empty paragraphs (≥3) with no table
//      following, drop the page break.
//   2. After that, collapse runs of >2 consecutive empty paragraphs at the
//      body level, keeping paragraphs that hold a drawing/picture.
//
// We walk top-level <w:body> children only — nested <w:p> inside <w:tbl>
// cells are left alone (they drive table cell layout). The walker is
// depth-counting, not regex-greedy, so nested paragraphs inside tables can't
// bleed into the sibling slice.

function splitBodyTopLevel(body: string): Array<{ tag: string; start: number; end: number }> {
  const items: Array<{ tag: string; start: number; end: number }> = [];
  const openRe = /<w:(p|tbl|sectPr)\b[^>]*?>/g;
  const selfClosingRe = /<w:(p|tbl|sectPr)\b[^>]*?\/>/g;
  let i = 0;
  while (i < body.length) {
    openRe.lastIndex = i;
    selfClosingRe.lastIndex = i;
    const open = openRe.exec(body);
    const selfClose = selfClosingRe.exec(body);
    let match: RegExpExecArray | null = null;
    if (open && selfClose) match = open.index <= selfClose.index ? open : selfClose;
    else match = open || selfClose;
    if (!match) break;

    const tag = match[1];
    const isSelfClosing = match[0].endsWith('/>');
    if (isSelfClosing) {
      items.push({ tag, start: match.index, end: match.index + match[0].length });
      i = match.index + match[0].length;
      continue;
    }

    let depth = 1;
    const scanRe = new RegExp(`<w:${tag}\\b[^>]*?(\\/?)>|</w:${tag}>`, 'g');
    scanRe.lastIndex = match.index + match[0].length;
    let endPos = -1;
    for (;;) {
      const s = scanRe.exec(body);
      if (!s) break;
      const isClose = s[0].startsWith('</');
      const isSC = s[0].endsWith('/>');
      if (isClose) {
        depth--;
        if (depth === 0) {
          endPos = s.index + s[0].length;
          break;
        }
      } else if (!isSC) {
        depth++;
      }
    }
    if (endPos === -1) break;
    items.push({ tag, start: match.index, end: endPos });
    i = endPos;
  }
  return items;
}

function extractParaTextContent(paraXml: string): string {
  let result = '';
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraXml)) !== null) result += m[1];
  return result;
}

function paraHasDrawing(paraXml: string): boolean {
  return /<w:drawing\b/.test(paraXml) || /<w:pict\b/.test(paraXml);
}

function paraHasPageBreak(paraXml: string): boolean {
  return /<w:br\b[^>]*w:type\s*=\s*"page"[^>]*\/?>/.test(paraXml);
}

function stripPageBreaks(paraXml: string): string {
  return paraXml.replace(/<w:br\b[^>]*w:type\s*=\s*"page"[^>]*\/?>/g, '');
}

function cleanupBlankPages(docXml: string): string {
  const bodyMatch = docXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return docXml;
  const body = bodyMatch[1];
  const items = splitBodyTopLevel(body);
  if (items.length === 0) return docXml;

  // Pass 1: remove REDUNDANT page breaks (back-to-back or separated only by
  // empty paragraphs). Critically, we only strip a break if we find ANOTHER
  // page break within the next 8 elements — that back-to-back pattern is
  // what produces a visibly-blank page. A single page break separating two
  // real sections (e.g. Version Control → Course Overview) is ALWAYS
  // preserved; otherwise the cleanup would merge sections Streamlit keeps
  // on separate pages.
  const pieces = items.map((it) => body.substring(it.start, it.end));
  for (let i = 0; i < items.length; i++) {
    if (items[i].tag !== 'p') continue;
    if (!paraHasPageBreak(pieces[i])) continue;

    let foundAnotherPageBreak = false;
    let hitRealContent = false;
    for (let j = i + 1; j < Math.min(i + 9, items.length); j++) {
      if (items[j].tag === 'tbl') {
        hitRealContent = true;
        break;
      }
      if (items[j].tag === 'p') {
        const t = extractParaTextContent(pieces[j]).trim();
        if (t.length > 3) {
          hitRealContent = true;
          break;
        }
        if (paraHasPageBreak(pieces[j])) {
          foundAnotherPageBreak = true;
          break;
        }
      }
    }
    // Only strip if we found a DUPLICATE break (redundant) and NO real
    // content between here and that duplicate.
    if (foundAnotherPageBreak && !hitRealContent) {
      pieces[i] = stripPageBreaks(pieces[i]);
    }
  }

  // Pass 2: collapse runs of >2 consecutive empty paragraphs. Paragraphs
  // that contain a page break (`<w:br w:type="page"/>`) are NEVER empty —
  // they are the sole carriers of section separation. A paragraph with a
  // drawing/pict is likewise preserved.
  const keep: boolean[] = pieces.map(() => true);
  let emptyCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].tag !== 'p') {
      emptyCount = 0;
      continue;
    }
    const t = extractParaTextContent(pieces[i]).trim();
    const hasStructure = paraHasDrawing(pieces[i]) || paraHasPageBreak(pieces[i]);
    if (!t && !hasStructure) {
      emptyCount++;
      if (emptyCount > 2) keep[i] = false;
    } else {
      emptyCount = 0;
    }
  }

  // Reassemble body. Preserve any whitespace/comments between items by using
  // the original body as the backbone and substituting piece-by-piece.
  let newBody = '';
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    newBody += body.substring(cursor, items[i].start);
    if (keep[i]) newBody += pieces[i];
    cursor = items[i].end;
  }
  newBody += body.substring(cursor);

  return docXml.replace(bodyMatch[0], `<w:body${bodyMatch[0].match(/<w:body(\b[^>]*)>/)?.[1] ?? ''}>${newBody}</w:body>`);
}

// ── Table-cell paragraph cleanup ─────────────────────────────────────────────
// Mirror of the body-level empty-paragraph collapse, scoped to each `<w:tc>`.
//
// Motivation: the AP template disables paragraph-level unwrap (see the
// `unwrapTagOnlyContainers(..., docType !== 'ap')` call) because the AP
// template contains inline `{% set %}` chains that break when unwrapped. As
// a result, every `{% for %}` / `{% endfor %}` tag inside a cell leaves a
// `<w:p>` behind, and after nunjucks renders, the cell ends up padded with
// many empty paragraphs — producing the giant blank-space-inside-cell we
// saw on the AP "Assessment Specification" page.
//
// We walk each table cell, find its direct-child paragraphs, and collapse
// runs of >2 consecutive empty ones. A cell must keep ≥1 `<w:p>` for Word
// to consider it valid OOXML, so we never drop the last remaining paragraph.

function splitCellTopLevelP(inner: string): Array<{ start: number; end: number }> {
  const items: Array<{ start: number; end: number }> = [];
  const openRe = /<w:p\b[^>]*?>/g;
  const selfClosingRe = /<w:p\b[^>]*?\/>/g;
  let i = 0;
  while (i < inner.length) {
    openRe.lastIndex = i;
    selfClosingRe.lastIndex = i;
    const open = openRe.exec(inner);
    const selfClose = selfClosingRe.exec(inner);
    let match: RegExpExecArray | null = null;
    if (open && selfClose) match = open.index <= selfClose.index ? open : selfClose;
    else match = open || selfClose;
    if (!match) break;

    if (match[0].endsWith('/>')) {
      items.push({ start: match.index, end: match.index + match[0].length });
      i = match.index + match[0].length;
      continue;
    }

    // `<w:p>` can contain nested blocks (tables inside cells, etc.) but
    // within a `<w:tc>` it generally doesn't nest another `<w:p>`. Use
    // depth-counting anyway to be safe.
    let depth = 1;
    const scanRe = /<w:p\b[^>]*?(\/?)>|<\/w:p>/g;
    scanRe.lastIndex = match.index + match[0].length;
    let endPos = -1;
    for (;;) {
      const s = scanRe.exec(inner);
      if (!s) break;
      const isClose = s[0].startsWith('</');
      const isSC = s[0].endsWith('/>');
      if (isClose) {
        depth--;
        if (depth === 0) {
          endPos = s.index + s[0].length;
          break;
        }
      } else if (!isSC) {
        depth++;
      }
    }
    if (endPos === -1) break;
    items.push({ start: match.index, end: endPos });
    i = endPos;
  }
  return items;
}

function cleanupTableCellEmptyParagraphs(docXml: string): string {
  // Don't traverse into nested tables here — replace handles each `<w:tc>` in
  // a single linear sweep, and tables inside cells get their own cells visited
  // by the same regex. Non-greedy `[\s\S]*?` keeps us from swallowing across
  // a `<w:tc>` boundary.
  return docXml.replace(/<w:tc\b([^>]*)>([\s\S]*?)<\/w:tc>/g, (_m, attrs: string, inner: string) => {
    const paras = splitCellTopLevelP(inner);
    if (paras.length <= 1) return `<w:tc${attrs}>${inner}</w:tc>`;

    const pieces = paras.map((p) => inner.substring(p.start, p.end));
    const keep: boolean[] = pieces.map(() => true);
    let emptyCount = 0;
    let lastNonEmpty = -1;
    // First pass: find last non-empty paragraph so we never drop it. A
    // paragraph with a page break is treated as meaningful even if its
    // text is empty.
    for (let i = pieces.length - 1; i >= 0; i--) {
      const t = extractParaTextContent(pieces[i]).trim();
      if (t || paraHasDrawing(pieces[i]) || paraHasPageBreak(pieces[i])) {
        lastNonEmpty = i;
        break;
      }
    }
    for (let i = 0; i < paras.length; i++) {
      const t = extractParaTextContent(pieces[i]).trim();
      const hasStructure = paraHasDrawing(pieces[i]) || paraHasPageBreak(pieces[i]);
      if (!t && !hasStructure) {
        emptyCount++;
        if (emptyCount > 2) keep[i] = false;
      } else {
        emptyCount = 0;
      }
    }
    // Guarantee ≥1 paragraph survives (Word requires it inside a cell).
    const anyKept = keep.some(Boolean);
    if (!anyKept && lastNonEmpty >= 0) keep[lastNonEmpty] = true;
    if (!keep.some(Boolean)) keep[0] = true;

    let rebuilt = '';
    let cursor = 0;
    for (let i = 0; i < paras.length; i++) {
      rebuilt += inner.substring(cursor, paras[i].start);
      if (keep[i]) rebuilt += pieces[i];
      cursor = paras[i].end;
    }
    rebuilt += inner.substring(cursor);
    return `<w:tc${attrs}>${rebuilt}</w:tc>`;
  });
}

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
    if (name === 'word/document.xml') {
      xml = keepHeadingsWithNext(xml);
      xml = cleanupTableCellEmptyParagraphs(xml);
      xml = cleanupBlankPages(xml);
      // Keep the empty paragraph between a heading and its table — the
      // Streamlit reference output has exactly that structure and Word
      // paginates it correctly. Removing the empty paragraph (earlier
      // attempt) actually broke Word's page layout, stranding the heading
      // alone above the table's new page. We rely on `keepNext`
      // propagation instead.
      xml = propagateKeepNextToEmptyParagraphs(xml);
      // LG / FG: ensure Course Overview starts on its own page. Run AFTER
      // cleanup so a dropped page break can't leave the sections fused.
      if (docType === 'lg' || docType === 'fg') {
        xml = forceCourseOverviewPageBreak(xml);
      }
    }
    zip.file(name, xml);
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
