/**
 * Matching of TC customer invoices that were created by hand in QuickBooks (running
 * numbers such as TC26-1003-01, no "SSG enrolment" PrivateNote, no LMS record) to the
 * enrolment they bill, so Consolidated Finance can show them.
 *
 * A manual invoice's course line describes the learner in full, e.g.
 *   Course Name: WSQ - Agentic AI for TikTok Marketing (TGS-2023036657)
 *   Participant Name: Ang Eng Choon / NRIC: XXXXX952A
 *   Course Date: 3-4 Oct 2026 (Sat/Sun) / Course Run: 1446356
 * and its funding lines carry the grant refs (GRN-…). Older hand-made invoices use another
 * layout, with no course run:
 *   WSQ - Practical Electronics Design with Arduino Microcontroller (TGS2020506075)
 *   Participant Name : TAN YING RU FRANCESCA (XXXXXX906D) / Course Date : 11 Aug 2026
 * A link is made only when the course code, learner name, NRIC tail AND the course run (or,
 * when the invoice has no run, the course start date) ALL agree with exactly one enrolment,
 * that enrolment has exactly one such invoice, and any grant refs on the invoice belong to
 * that same enrolment.
 */

/** invoice_jobs.batch_id marking a link to a hand-made QB invoice (never repaired by the processor). */
export const MANUAL_QB_LINK_BATCH = 'qb_manual_link';

export interface ParsedManualInvoice {
  qboInvoiceId: string;
  docNumber: string;
  txnDate: string;
  /** null when the invoice has no "Course Run:" — courseStartDate is used instead. */
  courseRunId: string | null;
  /** YYYY-MM-DD from "Course Date: …" (first day of a range), or null. */
  courseStartDate: string | null;
  courseCode: string;
  participantName: string;
  nricTail: string | null;
  grnRefs: string[];
}

export interface MatchableEnrolment {
  enrolmentId: string;
  courseRunId: string | null;
  /** YYYY-MM-DD run start date. */
  courseStartDate?: string | null;
  courseReference: string | null;
  traineeName: string | null;
  traineeNric: string | null;
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "11 Aug 2026", "3-4 Oct 2026 (Sat/Sun)", "28 Sep - 2 Oct 2026" → first day as YYYY-MM-DD. */
function courseStartFromText(text: string): string | null {
  const m = text.match(/Course Date\s*:\s*(\d{1,2})\s*(?:([A-Za-z]{3})[a-z]*)?\s*(?:-|–|to)?\s*(?:\d{1,2}\s*)?([A-Za-z]{3})[a-z]*\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[String(m[2] || m[3]).toUpperCase()];
  if (!month) return null;
  return `${m[4]}-${month}-${m[1].padStart(2, '0')}`;
}

/** Name key: uppercase letters only, so "Ang Eng Choon" == "ANG ENG CHOON" == "ANG ENG-CHOON". */
export function nameKey(name: string | null | undefined): string {
  return String(name || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function nricTail(nric: string | null | undefined): string | null {
  const s = String(nric || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 4 ? s.slice(-4) : null;
}

/** Parse a QB invoice (SELECT * shape). Returns null unless it is a TC invoice with a full course line. */
export function parseManualInvoice(inv: any): ParsedManualInvoice | null {
  const docNumber = String(inv?.DocNumber || '').trim();
  if (!/^TC\d{2}-\d{4}-\d+$/i.test(docNumber)) return null;
  const lines: any[] = Array.isArray(inv?.Line) ? inv.Line : inv?.Line ? [inv.Line] : [];
  const texts: string[] = lines.map((l: any) => String(l?.Description || ''));
  // Exactly one course line per invoice — a group (company) invoice lists several learners
  // and is never matched to a single enrolment here.
  const courseLines = texts.filter((t) => /Participant Name\s*:/i.test(t));
  if (courseLines.length !== 1) return null;
  const course = courseLines[0];
  const run = course.match(/Course Run\s*:\s*(\d+)/i)?.[1] ?? null;
  const codeDigits = course.match(/\bTGS-?(\d{6,})\b/i)?.[1];
  // Name ends at a line break, "/", an opening bracket (NRIC in brackets) or the next label.
  const name = course
    .match(/Participant Name\s*:\s*([^\n\r(/]+?)\s*(?=\(|\/|\n|\r|NRIC\s*:|Course Date\s*:|Course Run\s*:|$)/i)?.[1]
    ?.trim();
  const nric =
    course.match(/NRIC\s*:\s*([A-Z0-9X*]+)/i)?.[1] ||
    course.match(/Participant Name\s*:[^\n\r(]*\(\s*([A-Z0-9X*]{5,})\s*\)/i)?.[1];
  const startDate = courseStartFromText(course);
  if (!codeDigits || !name || (!run && !startDate)) return null;
  const grnRefs = Array.from(new Set(texts.join('\n').match(/GRN-\d{4}-\d+/gi) || [])).map((g) => g.toUpperCase());
  return {
    qboInvoiceId: String(inv.Id),
    docNumber,
    txnDate: String(inv.TxnDate || ''),
    courseRunId: run,
    courseStartDate: startDate,
    courseCode: `TGS-${codeDigits}`,
    participantName: name,
    nricTail: nric ? nricTail(nric) : null,
    grnRefs,
  };
}

export type ManualMatchOutcome =
  | { kind: 'match'; invoice: ParsedManualInvoice; enrolmentId: string }
  | { kind: 'skip'; invoice: ParsedManualInvoice; reason: string };

/**
 * Pair parsed invoices with enrolments. Every field must agree; anything ambiguous
 * (two enrolments for one invoice, or two invoices for one enrolment) is skipped.
 */
export function matchManualInvoices(
  invoices: ParsedManualInvoice[],
  enrolments: MatchableEnrolment[],
  /** GRN → enrolment that grant belongs to (from ssg_grants); a cited grant of another learner vetoes the match. */
  grantOwner?: Map<string, string>
): ManualMatchOutcome[] {
  const codeKey = (c: string | null | undefined) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const proposed: Array<{ invoice: ParsedManualInvoice; enrolmentId: string }> = [];
  const out: ManualMatchOutcome[] = [];
  for (const inv of invoices) {
    const candidates = enrolments.filter((e) => {
      if (inv.courseRunId) {
        if (String(e.courseRunId || '').trim() !== inv.courseRunId) return false;
      } else if (!inv.courseStartDate || String(e.courseStartDate || '').slice(0, 10) !== inv.courseStartDate) {
        return false;
      }
      if (nameKey(e.traineeName) !== nameKey(inv.participantName)) return false;
      if (codeKey(e.courseReference) !== codeKey(inv.courseCode)) return false;
      const tail = nricTail(e.traineeNric);
      return !!inv.nricTail && !!tail && tail === inv.nricTail;
    });
    if (candidates.length !== 1) {
      out.push({ kind: 'skip', invoice: inv, reason: candidates.length === 0 ? 'no enrolment matches every field' : 'several enrolments match' });
      continue;
    }
    const enrolmentId = candidates[0].enrolmentId;
    const foreign = inv.grnRefs.filter((g) => grantOwner?.get(g) && grantOwner.get(g) !== enrolmentId);
    if (foreign.length) {
      out.push({ kind: 'skip', invoice: inv, reason: `grant ref ${foreign[0]} belongs to another enrolment` });
      continue;
    }
    proposed.push({ invoice: inv, enrolmentId });
  }

  const perEnrolment = new Map<string, number>();
  for (const p of proposed) perEnrolment.set(p.enrolmentId, (perEnrolment.get(p.enrolmentId) || 0) + 1);
  for (const p of proposed) {
    if (perEnrolment.get(p.enrolmentId) === 1) out.push({ kind: 'match', ...p });
    else out.push({ kind: 'skip', invoice: p.invoice, reason: 'enrolment has several matching invoices' });
  }
  return out;
}
