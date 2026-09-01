import pool from '@/lib/db';
import { realApplicationId } from '@/lib/daApplicationId';

function toLineArray(lines: any): any[] {
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

function invoiceLineText(inv: any): string {
  return toLineArray(inv?.Line)
    .map((l: any) => String(l?.Description || ''))
    .join(' \n ')
    .toUpperCase();
}

function normNric(n: string | null | undefined): string {
  return String(n || '').trim().toUpperCase();
}

const SHORT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Whether `text` (already uppercased) contains this course's start date. Invoice
 * wording is a human-typed field (`Course Date: 26 Jun 2026`, sometimes as part of
 * a multi-day range like `26-27 Jun 2026`), so this checks several literal single-date
 * spellings first and falls back to a proximity match (day, month, year all present
 * near each other) to tolerate range formatting without accepting a coincidental hit.
 */
function dateHitInText(text: string, isoDate: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return false;
  const [, year, moStr, dStr] = m;
  const monAbbr = SHORT_MONTHS[parseInt(moStr, 10) - 1];
  if (!monAbbr) return false;
  const day = String(parseInt(dStr, 10));
  const literals = [
    `${day} ${monAbbr} ${year}`,
    `${dStr} ${monAbbr} ${year}`,
    `${dStr}/${moStr}/${year}`,
    `${day}/${parseInt(moStr, 10)}/${year}`,
    `${year}-${moStr}-${dStr}`,
    `${dStr}-${moStr}-${year}`,
  ];
  if (literals.some((l) => text.includes(l.toUpperCase()))) return true;
  const rangeRe = new RegExp(`\\b${day}\\b[\\s\\S]{0,20}${monAbbr}[\\s\\S]{0,15}${year}\\b`);
  return rangeRe.test(text);
}

/** Whether `text` contains this exact value as a distinct token, not just a loose substring. */
function tokenHitInText(text: string, value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return re.test(text);
}

export type SfcInvoiceVerifyResult = { ok: boolean; reason: string };

/**
 * Verify a resolved QuickBooks invoice is actually the right one for this SFC claim —
 * required before a row may ever reach `ready`/`already_applied`, and re-checked again
 * immediately before any payment write. Trusting a cached invoice id without this check
 * is exactly how SFC claims previously ended up "already applied" against grant invoices
 * and other learners' invoices.
 *
 * Two hard rules, matching how these invoices are structured in this company's QuickBooks:
 *  - A non-DA SFC claim must resolve to the enrolment's Customer invoice (DocNumber "TC...").
 *  - A DA SFC claim must resolve to its supplemental SFC invoice (DocNumber "SFC-CA-...").
 * Anything else (GRN- grant invoices, legacy TG-/bare-numeric invoices, or no invoice at
 * all) is refused outright — an SFC claim payment must never land on a grant invoice or an
 * invoice belonging to an unrelated learner/course.
 */
export async function verifySfcInvoiceMatch(input: {
  invoiceRaw: any;
  docNumber: string | null;
  matchedEnrolmentId: string | null;
  excelNric: string | null;
  excelCourseRef: string | null;
  /**
   * When both of these are supplied, TC verification becomes strict: NRIC, course
   * reference, course date AND course run must all be found in the invoice text (not
   * just one of NRIC/course-ref, the legacy rule below). Omit either to keep the
   * legacy behaviour for callers that don't have this data on hand.
   */
  courseStartDateIso?: string | null;
  courseRunId?: string | null;
  /**
   * The specific DA application this row/claim is actually for. Supply this whenever the
   * caller already knows it (every current caller does). Without it, SFC-CA verification
   * falls back to looking application_id up by enrolment_id alone — ambiguous, and confirmed
   * live to pick the WRONG one when a learner has more than one da_application row for the
   * same enrolment (e.g. a resubmitted application): an unordered `LIMIT 1` can hand back
   * either, and a genuinely correct invoice failed verification against the wrong one.
   */
  daApplicationId?: string | null;
}): Promise<SfcInvoiceVerifyResult> {
  const doc = String(input.docNumber || '').trim();
  if (!doc) return { ok: false, reason: 'No invoice DocNumber to verify against' };

  const isTc = /^TC/i.test(doc);
  const isSfcCa = /^SFC-CA-/i.test(doc);
  if (!isTc && !isSfcCa) {
    return {
      ok: false,
      reason: `Invoice ${doc} is not a Customer (TC...) or SFC (SFC-CA-...) invoice — refusing to apply an SFC payment to it`,
    };
  }

  const text = invoiceLineText(input.invoiceRaw);

  if (isSfcCa) {
    // SFC-CA invoice descriptions cite either the real Application ID or, for manually-enrolled
    // learners with no MySkillsFuture application, the enrolment id — but the exact wording and
    // spacing has varied across invoices generated at different times (confirmed: real examples
    // include both "Application ID: CA-..." and "APPLICATION ID : SFC-CA-..." — space before the
    // colon, and the value shown as either the bare application id or the invoice's own SFC-CA
    // doc number). A strict single-format regex silently rejected a genuinely correct match here
    // once already — check by substring against every value we know is legitimate instead of
    // parsing one exact template.
    let daAppId = realApplicationId(input.daApplicationId);
    if (!daAppId) {
      const r = await pool.query(
        `SELECT application_id FROM public.da_application WHERE LOWER(TRIM(enrolment_id)) = LOWER(TRIM($1)) LIMIT 1`,
        [input.matchedEnrolmentId]
      );
      daAppId = realApplicationId(r.rows[0]?.application_id);
    }
    const enrIdUpper = String(input.matchedEnrolmentId || '').trim().toUpperCase();

    if (daAppId) {
      const daAppIdUpper = daAppId.toUpperCase();
      const sfcDocForm = `SFC-${daAppIdUpper}`;
      if (text.includes(daAppIdUpper) || text.includes(sfcDocForm)) {
        return { ok: true, reason: `SFC-CA invoice content mentions Application ID ${daAppIdUpper}` };
      }
    }
    if (enrIdUpper && text.includes(enrIdUpper)) {
      return { ok: true, reason: `SFC-CA invoice content mentions Enrolment ID ${enrIdUpper}` };
    }

    return {
      ok: false,
      reason: daAppId
        ? `Invoice ${doc} description does not mention Application ID ${daAppId} (or SFC-${daAppId}) or Enrolment ID ${input.matchedEnrolmentId}: "${text.slice(0, 200)}"`
        : `Invoice ${doc} description does not mention Enrolment ID ${input.matchedEnrolmentId}, and no real application_id was found in da_application to check against either: "${text.slice(0, 200)}"`,
    };
  }

  // TC customer invoice: description carries "Participant Name / NRIC / Course Date / Course Run".
  const nricLast4 = normNric(input.excelNric).slice(-4);
  const courseRefHit = !!(input.excelCourseRef && text.includes(String(input.excelCourseRef).toUpperCase()));
  const nricHit = !!(nricLast4 && text.includes(nricLast4));

  // Strict mode: caller supplied the course's date and run, so require all four
  // identifying fields to be found — not just one of NRIC/course-ref (the legacy rule).
  // Course reference and run use a distinct token match (word boundaries) since a looser
  // substring check has a real, if small, chance of a coincidental false positive when this
  // mode backs the unrestricted full-database scan (Stage 2 of Sync QB Invoice IDs). NRIC is
  // deliberately NOT boundary-checked: QuickBooks always masks it as "XXXXX685F" — the last 4
  // characters are glued directly onto the masking X's with no separator, so a `\b` boundary
  // never exists before them and a boundary-checked NRIC match always fails (confirmed live —
  // this is what silently zeroed out every match after the boundary check was first added).
  if (input.courseStartDateIso && input.courseRunId) {
    const strictNricHit = nricHit;
    const strictCourseRefHit = tokenHitInText(text, String(input.excelCourseRef || '').toUpperCase());
    const dateHit = dateHitInText(text, input.courseStartDateIso);
    const runHit = tokenHitInText(text, input.courseRunId);
    const failed: string[] = [];
    if (!strictNricHit) failed.push(`NRIC (...${nricLast4})`);
    if (!strictCourseRefHit) failed.push(`course reference (${input.excelCourseRef})`);
    if (!dateHit) failed.push(`course date (${input.courseStartDateIso})`);
    if (!runHit) failed.push(`course run (${input.courseRunId})`);
    if (failed.length > 0) {
      return {
        ok: false,
        reason: `Invoice ${doc} does not match on: ${failed.join(', ')}. Text: "${text.slice(0, 200)}"`,
      };
    }
    return { ok: true, reason: 'TC invoice content verified exactly (NRIC, course reference, course date and course run all matched)' };
  }

  if (!nricHit && !courseRefHit) {
    return {
      ok: false,
      reason: `Invoice ${doc} line text does not contain this claim's NRIC (...${nricLast4}) or course reference (${input.excelCourseRef}): "${text.slice(0, 200)}"`,
    };
  }
  return { ok: true, reason: `TC invoice content verified (nricHit=${nricHit} courseRefHit=${courseRefHit})` };
}
