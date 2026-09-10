/**
 * Does a QuickBooks invoice actually belong to the row we are about to attach
 * it to?
 *
 * Both invoice paths recover an "orphan" — an invoice a previous attempt posted
 * to QBO but failed to record locally — by searching for its document number.
 * The fallback search is a LIKE on the trailing six characters of the enrolment
 * reference (`TC%-019463`), because a retry on a later day computes a different
 * date prefix.
 *
 * That suffix is NOT unique. SSG reissues the same trailing six digits in
 * different periods: `ENR-2512-019463` and `ENR-2609-019463` both exist in this
 * database, and 22 enrolments across 11 suffixes collide that way. So the search
 * cheerfully returned an invoice raised months earlier for a different learner,
 * and the pipeline adopted it — attaching one person's invoice to another,
 * and never raising an invoice for the second person at all.
 *
 * The search is not wrong to exist; it is wrong to trust. A candidate is only
 * adopted when something on the invoice itself positively identifies this row.
 * Line descriptions already carry the application id, the enrolment reference,
 * the participant name and the course run, so no extra QBO call is needed —
 * `SELECT *` already returned the lines.
 *
 * Silence means no. An invoice we cannot positively tie to this row is treated
 * as somebody else's, and a fresh one is raised instead. Raising a duplicate is
 * recoverable; billing the wrong person is not.
 */

/** Every line description on an invoice, upper-cased, for token matching. */
export function invoiceLineText(rawInvoice: unknown): string {
  const lines = (rawInvoice as { Line?: unknown } | null | undefined)?.Line;
  if (!Array.isArray(lines)) return '';
  return lines
    .map((line) => String((line as { Description?: unknown } | null)?.Description ?? ''))
    .join('\n')
    .toUpperCase();
}

const clean = (tokens: (string | null | undefined)[]): string[] =>
  tokens.map((t) => String(t ?? '').trim().toUpperCase()).filter(Boolean);

/** True when every token is present. An empty token list is never a match. */
export function textHasAll(text: string, tokens: (string | null | undefined)[]): boolean {
  const wanted = clean(tokens);
  if (wanted.length === 0) return false;
  return wanted.every((t) => text.includes(t));
}

/** True when at least one token is present. */
export function textHasAny(text: string, tokens: (string | null | undefined)[]): boolean {
  return clean(tokens).some((t) => text.includes(t));
}

/**
 * Direct Application: the SFC line carries the application id, or the enrolment
 * reference when there is no real application. Either alone is conclusive.
 * Without them, the participant name and course run together are specific
 * enough — the same learner on the same run is the same invoice.
 */
export function daInvoiceBelongsTo(
  rawInvoice: unknown,
  ids: {
    applicationId?: string | null;
    enrolmentId?: string | null;
    traineeName?: string | null;
    courseRunId?: string | null;
  }
): boolean {
  const text = invoiceLineText(rawInvoice);
  if (!text) return false;
  if (textHasAny(text, [ids.applicationId, ids.enrolmentId])) return true;
  return textHasAll(text, [ids.traineeName, ids.courseRunId]);
}

/**
 * Company Application: one invoice covers a group, keyed by employer and course
 * run, so the run id must match and at least one of this group's learners must
 * appear. A late joiner changes the list but never empties it.
 */
export function caInvoiceBelongsTo(
  rawInvoice: unknown,
  ids: { courseRunId?: string | null; learnerNames?: (string | null | undefined)[] }
): boolean {
  const text = invoiceLineText(rawInvoice);
  if (!text) return false;
  return textHasAll(text, [ids.courseRunId]) && textHasAny(text, ids.learnerNames ?? []);
}
