/**
 * Invoice line text, built from the QuickBooks product rather than from code.
 *
 * WHY THIS EXISTS
 *
 * Every fixed word on a Direct Application invoice line used to be a string
 * literal in our source: `Course Name: WSQ - …`, `Less: WSQ funding (Baseline)`,
 * `SkillsFuture Credit Usage/Claim:`. When SSG renewed a batch of courses from
 * WSQ to CASL (Aug 2026) — new titles, new TGS codes, new funding scheme names —
 * every one of those invoices printed "WSQ" at a learner, and the only fix was a
 * deploy.
 *
 * Admin staff already maintain the wording: each Product/Service in QuickBooks
 * carries a Description box holding the course title and a set of blank labels
 * (`Name:`, `NRIC:`, `Course Date:`, `Course Run:`) that a human fills in when
 * raising an invoice by hand. That box is the source of truth. This module reads
 * it and fills the blanks in, so a course renewed to CASL is corrected by editing
 * the product — no developer, no deploy.
 *
 * WHAT COMES FROM WHERE
 *
 *   From the product : the heading line(s) and every label, verbatim — including
 *                      the `Grant Ref #;` semicolon and other typos. We do not
 *                      "correct" the text on the way out; the moment we do,
 *                      QuickBooks stops being the source of truth and the wording
 *                      lives in two places again.
 *   From our data    : the values — participant name, masked NRIC, course dates,
 *                      course run, grant references, claim ids.
 *
 * THE TEMPLATES ARE NOT UNIFORM, AND THAT IS THE POINT
 *
 * Across the 1,258 products in the live realm: CASL products say `Name:`, most
 * WSQ products say `Participant Name:`, a few say `Participant:` or
 * `Participants Name:`; some have no `Course Run:` line; one says `Date:`. Rather
 * than impose one house style (which would override what staff typed), each
 * product's own labels are filled in, and any field the template omits is
 * appended at the end so nothing is silently dropped from a tax invoice.
 *
 * WHEN THE PRODUCT IS NOT TRUSTED
 *
 * Three products describe a different course than the one they are filed under —
 * `CASL - Quickbooks Accounting System` (SKU TGS-2026064181) still cites the old
 * `TGS-2020505113` in its description. Printing that on a learner's tax invoice
 * is worse than printing our own correct title, so a description whose course
 * code contradicts the course falls back to data we hold, and says so in the log
 * for cleanup.
 */

/**
 * The label that opens a course line: `Course Name: CASL - ... (TGS-...)`.
 *
 * The one piece of wording still written by us rather than read from the
 * product, and a deliberate exception (asked for 2026-08-24). Only 53 of the
 * 1,258 products carry it in their Description box; the other 1,171 open
 * straight with the title, and editing them all by hand is not realistic. So the
 * label is applied here when the box does not already start with it.
 *
 * It is a LABEL, not content: the course name itself, the code, and every other
 * word on the line still come from QuickBooks. Kept as a single named constant
 * so there is exactly one place to change it.
 */
export const COURSE_LINE_HEADING_PREFIX = 'Course Name:';

/** Prepend the label unless this heading already opens with it. */
function applyHeadingPrefix(heading: string, prefix: string | undefined): string {
  const line = String(heading || '');
  const label = String(prefix || '').trim();
  if (!label || !line.trim()) return line;
  const bare = label.replace(/:$/, '');
  if (new RegExp(`^\\s*${bare.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*:`, 'i').test(line)) return line;
  return `${label} ${line.trim()}`;
}

/** A value the LMS fills into the line. */
export interface LineField {
  /**
   * Which blank this fills. Matched against the product's own labels, so
   * `Name:` / `Participant Name:` / `Participant:` all receive the `name` field.
   */
  key: FieldKey;
  /** Label used only when the product's template has no line for this field. */
  label: string;
  value: string;
  /**
   * Render the value on the line BELOW the label instead of after it. Used for
   * grant references, which print as a numbered list under `Grant Ref #:`.
   */
  block?: boolean;
}

export type FieldKey = 'name' | 'nric' | 'date' | 'run' | 'grantRef' | 'claim';

export interface BuiltLineText {
  text: string;
  /** `product` when the wording came from QuickBooks, `fallback` when we built it. */
  source: 'product' | 'fallback';
  /** Why the product text was rejected — logged so the product can be fixed. */
  reason?: string;
}

/**
 * Label spellings seen in the live realm, mapped to the field they receive.
 * Compared after lowercasing and stripping punctuation/whitespace, so
 * `Course Date :` and `COURSE DATE:` both land on `date`.
 */
const LABEL_ALIASES: Record<string, FieldKey> = {
  'name': 'name',
  'participant': 'name',
  'participantname': 'name',
  'participantsname': 'name',
  'participantname s': 'name',
  'traineename': 'name',
  'nric': 'nric',
  'nricfin': 'nric',
  'traineeid': 'nric',
  'coursedate': 'date',
  'date': 'date',
  'trainingdate': 'date',
  'courserun': 'run',
  'run': 'run',
  'courserunid': 'run',
  'grantref': 'grantRef',
  'grantrefno': 'grantRef',
  'grantreference': 'grantRef',
  'skillsfutureclaimid': 'claim',
  'claimid': 'claim',
  'applicationid': 'claim',
  'skillsfutureclaim': 'claim',
};

/** `Course Date :` -> `coursedate`; `Grant Ref #;` -> `grantref`. */
function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * A line that is a label with an empty (or fillable) slot, e.g. `Name:`,
 * `Grant Ref #;`, `Course Date : `. Trailing `:` or `;` both count — the realm
 * has products using each.
 */
const LABEL_LINE = /^\s*([A-Za-z][A-Za-z0-9 .#/'()-]{0,48}?)\s*[:;]\s*(.*)$/;

function matchLabelLine(line: string): { label: string; key: FieldKey } | null {
  const m = line.match(LABEL_LINE);
  if (!m) return null;
  const key = LABEL_ALIASES[normalizeLabel(m[1])];
  if (!key) return null;
  // Keep the product's own punctuation and spacing — `Course Date :` stays
  // `Course Date :` on the invoice.
  const label = line.slice(0, line.length - m[2].length).replace(/\s+$/, '');
  return { label, key };
}

const COURSE_CODE = /\b(TGS-\d{6,})\b/i;

/**
 * Split the product description into its heading (course title, scheme name —
 * whatever sits above the first label) and its label lines.
 *
 * Stops at a repeat of the first heading line: one product has its whole block
 * pasted in twice, and printing it twice on an invoice would look like a fault.
 */
function parseTemplate(description: string): {
  heading: string[];
  labels: { label: string; key: FieldKey }[];
} {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
  const heading: string[] = [];
  const labels: { label: string; key: FieldKey }[] = [];
  let seenLabel = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim()) continue;

    // The block restarts — everything from here is a duplicate.
    if (seenLabel && heading.length > 0 && line.trim() === heading[0].trim()) break;

    const matched = matchLabelLine(line);
    if (matched) {
      seenLabel = true;
      if (!labels.some(l => l.key === matched.key)) labels.push(matched);
      continue;
    }

    // A non-label line after the labels have started is loose text (a stray
    // value someone left behind); it is not part of the heading.
    if (!seenLabel) heading.push(line);
  }

  return { heading, labels };
}

function renderField(label: string, field: LineField): string[] {
  if (!field.value) return [];
  return field.block ? [label, field.value] : [`${label} ${field.value}`];
}

/**
 * Build one invoice line's Description.
 *
 * `expectedCode` enables the mismatch guard: pass the course reference the
 * product is supposed to describe and a description citing a different TGS code
 * is rejected. Omit it for lines that carry no course code (funding, credit).
 */
export function buildInvoiceLineText(input: {
  productDescription: string | null | undefined;
  fields: LineField[];
  /** Used verbatim as the heading when the product text can't be used. */
  fallbackHeading: string;
  expectedCode?: string | null;
  /**
   * Label to open the first heading line with, when it does not already carry
   * one. Course lines pass COURSE_LINE_HEADING_PREFIX; funding and credit lines
   * pass nothing, since their products word themselves fully.
   */
  headingPrefix?: string;
}): BuiltLineText {
  const description = String(input.productDescription ?? '').trim();
  const usable = input.fields.filter(f => f.value);

  const fallback = (reason: string): BuiltLineText => ({
    text: [
      applyHeadingPrefix(input.fallbackHeading, input.headingPrefix),
      ...usable.flatMap(f => renderField(`${f.label}:`, f)),
    ]
      .filter(Boolean)
      .join('\n'),
    source: 'fallback',
    reason,
  });

  if (!description) {
    return fallback('the product has no Description');
  }

  const { heading, labels } = parseTemplate(description);

  if (heading.length === 0) {
    return fallback('the product Description has no heading line');
  }

  if (input.expectedCode) {
    const cited = heading.join(' ').match(COURSE_CODE)?.[1];
    if (cited && cited.toUpperCase() !== String(input.expectedCode).trim().toUpperCase()) {
      return fallback(
        `the product Description cites ${cited} but this course is ${input.expectedCode}`
      );
    }
  }

  const out = [...heading];
  out[0] = applyHeadingPrefix(out[0], input.headingPrefix);
  const placed = new Set<FieldKey>();

  // Fill the template's own labels, in the order the product lists them. A
  // label with no matching value is dropped rather than printed blank.
  for (const { label, key } of labels) {
    const field = usable.find(f => f.key === key);
    if (!field) continue;
    out.push(...renderField(label, field));
    placed.add(key);
  }

  // Anything the template forgot still belongs on the invoice.
  for (const field of usable) {
    if (placed.has(field.key)) continue;
    out.push(...renderField(`${field.label}:`, field));
  }

  return { text: out.join('\n'), source: 'product' };
}

/**
 * Which family of funding products a course bills against.
 *
 * Read from the course product itself (its Name/Description begin `CASL - …` or
 * `WSQ - …`) rather than from our `course.course_type` column, so a renewal is
 * reflected the moment the QuickBooks product is right — the same single source
 * of truth as the wording.
 */
export type FundingFamily = 'CASL' | 'WSQ';

/**
 * Course heading used when the product's Description box cannot supply one.
 *
 * Kept in the same shape the product templates use - `CASL - Title (TGS-...)` -
 * so a fallback line is indistinguishable from a normal one on the invoice. The
 * prefix is skipped when the stored title already carries it, which most do.
 */
export function buildCourseHeading(opts: {
  family: FundingFamily;
  title: string | null | undefined;
  courseCode: string | null | undefined;
}): string {
  const title = String(opts.title || '').trim();
  const code = String(opts.courseCode || '').trim();
  if (!title) return code;
  // Strip any prefix the stored title already carries before applying the right
  // one. Keeping it would preserve a WRONG one: a course renewed to CASL often
  // still has "WSQ - ..." in the title we hold, and that is exactly the case
  // this heading exists to get right.
  const base = title.replace(/^(WSQ|CASL|IBF|Non-WSQ)\s*[-–]\s*/i, '');
  const prefixed = `${opts.family} - ${base}`;
  return code && !prefixed.includes(code) ? `${prefixed} (${code})` : prefixed;
}

export function detectFundingFamily(...candidates: (string | null | undefined)[]): FundingFamily {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (/^casl\b/i.test(text)) return 'CASL';
    if (/^wsq\b/i.test(text)) return 'WSQ';
  }
  return 'WSQ';
}

/**
 * The QuickBooks product name for a funding deduction line.
 *
 * WSQ has four products (Baseline / MCES / SMEs / MCES-SME). CASL has two, and
 * that is deliberate — asked whether to create the missing pair, the decision
 * (2026-08-24) was to keep the two and let every non-baseline CASL grant use the
 * combined product. Such a learner's line reads "Mid-Career Enhanced Subsidy OR
 * Enhanced Training Support for SMEs": broader than the grant they actually
 * received, but correct in amount and never mislabelled as WSQ.
 *
 * These are LOOKUP KEYS: each must name a real Product/Service in the realm.
 * QuickBooks compares Name case-insensitively — verified live on 2026-08-24, when
 * `WSQ funding (Baseline)` still resolved after the products had been renamed to
 * `WSQ Funding (Baseline)` — so capitalisation drift between here and QuickBooks
 * is survivable, but the words and brackets are not.
 *
 * A name with no product throws upstream, which is the right outcome: an invoice
 * missing its subsidy line overcharges a learner.
 */
export function resolveFundingItemName(opts: {
  family: FundingFamily;
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
}): string {
  const haystack = `${opts.fundingSchemeCode || ''} ${opts.fundingSchemeDescription || ''}`.toLowerCase();
  const isBaseline = /baseline|\bbl\b/.test(haystack);

  if (opts.family === 'CASL') {
    return isBaseline ? 'CASL Funding (Baseline)' : 'CASL Funding (MCES/SME)';
  }

  if (isBaseline) return 'WSQ Funding (Baseline)';

  const hasMces = /\bmces\b|mid-career enhanced subsidy/.test(haystack);
  const hasSme = /\bsme\b|\bsmes\b|enhanced training support for smes/.test(haystack);

  if (hasMces && hasSme) return 'WSQ Funding (MCES/SME)';
  if (hasMces) return 'WSQ Funding (MCES)';
  if (hasSme) return 'WSQ Funding (SMEs)';
  return 'WSQ Funding (MCES/SME)';
}
