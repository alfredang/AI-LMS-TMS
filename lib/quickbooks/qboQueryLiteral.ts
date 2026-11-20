/**
 * Escape a value for a single-quoted string in a QuickBooks Online query
 * (`SELECT … FROM Customer WHERE DisplayName = '…'`).
 *
 * QBO's query language escapes an apostrophe with a BACKSLASH (`\'`), not by
 * doubling it the way SQL does. Doubling (`''`) ends the string early, so QBO
 * rejects the whole query with "QueryParserError: Encountered <STRING>" — every
 * employer with an apostrophe in its name ("Paula's Choice …", "… Women's &
 * Children's Hospital") failed invoice generation that way. Verified against
 * the live realm: `''` → parse error, `\'` → matches.
 *
 * Never use this for Postgres — SQL there must stay parameterised.
 */
export function escapeQboQueryLiteral(value: unknown): string {
  return String(value ?? '').replace(/'/g, "\\'");
}
