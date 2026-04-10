/**
 * Pure helpers for the Auto Sanitise Data sweep.
 *
 * Both helpers are intentionally idempotent — re-running the sweep on
 * already-sanitised values is a no-op because the regexes require real
 * digits in the redaction window.
 */

// NRIC: prefix letter + 4 digits + 3 digits + suffix letter (Singapore format).
// Example: S1808997A → Sxxxx997A
// Idempotency: requires 4 actual digits at positions 1-4. Already-sanitised
// strings have 'xxxx' there and will not match.
const NRIC_RE = /^([A-Za-z])(\d{4})(\d{3})([A-Za-z])$/;

export function sanitiseNric(value: string | null | undefined): string | null {
  if (value == null) return null;
  const m = String(value).trim().match(NRIC_RE);
  if (!m) return value as string; // not an NRIC shape, or already sanitised
  return `${m[1]}xxxx${m[3]}${m[4]}`;
}

// Phone sanitisation:
//   96983371         → 9xxxx371
//   +65 9698 3371    → 9xxxx371  (bare Singapore local number preserved as-is)
//   +6596983371      → 9xxxx371
//   +60167309733     → 6xxxx733  (Malaysian, sanitise the last 8 digits)
//   +26590862487     → 9xxxx487  (typo / foreign, sanitise the last 8 digits)
//
// Strategy: after stripping separators + optional +65 prefix (which is the
// most common case for Singapore numbers, handled identically to the bare
// form), if the result is exactly 8 digits we sanitise it to the canonical
// `9xxxx371` shape. Otherwise we look for the **last** 8 consecutive digits
// anywhere in the string and sanitise those in place, leaving any prefix
// digits intact. This is safer than picking the first 8 digits because
// it keeps country-code digits at the front recognisable while still
// redacting the middle of the subscriber number.
//
// Idempotency: values already containing `xxxx` in the sanitised positions
// have fewer than 8 contiguous digits anywhere in the string and fall
// through the logic unchanged.
const PHONE_8_DIGIT_RE = /^(\d)(\d{4})(\d{3})$/;
// Match a run of 8+ contiguous digits, then we pick the LAST 8 of that run
// (i.e. if the run is 11 digits long at positions 1-11, we sanitise
// positions 4-11, leaving positions 1-3 visible as the country code).
const DIGIT_RUN_RE = /(\d{8,})/;

export function sanitisePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const original = String(value);

  // 1. Strip separators + the Singapore country code to normalise the
  //    common case. Most rows in the DB are plain `96983371` or
  //    `+65 9698 3371`, and both should produce `9xxxx371`.
  const strippedLocal = original.replace(/[\s\-]/g, '').replace(/^\+?65/, '');
  const m = strippedLocal.match(PHONE_8_DIGIT_RE);
  if (m) {
    return `${m[1]}xxxx${m[3]}`;
  }

  // 2. Fallback for international or malformed-with-extra-digits numbers.
  //    Find a run of 8+ contiguous digits and sanitise positions 4..7
  //    (0-indexed) within the **last 8 digits** of that run. This leaves
  //    any country-code prefix intact and redacts the middle of the
  //    actual subscriber number:
  //
  //      +60167309733  (run = 60167309733, 11 digits)
  //        → last 8 of run = 67309733
  //        → sanitise       = 6xxxx733
  //        → splice back    = +6016xxxx733
  //
  //      +26590862487  (run = 26590862487, 11 digits)
  //        → last 8 of run = 90862487
  //        → sanitise       = 9xxxx487
  //        → splice back    = +2659xxxx487
  const run = DIGIT_RUN_RE.exec(strippedLocal);
  if (run) {
    const runStr = run[1];
    const runStart = run.index;
    const lastEightStart = runStart + runStr.length - 8;
    const eight = runStr.slice(-8);
    const sanitisedEight = `${eight[0]}xxxx${eight.slice(5)}`;
    return (
      strippedLocal.slice(0, lastEightStart) +
      sanitisedEight +
      strippedLocal.slice(lastEightStart + 8)
    );
  }

  // 3. Truly unhandleable (fewer than 8 digits, e.g. +659687546) — pass
  //    through unchanged. These rows will still match the SQL predicate
  //    on subsequent runs, but they're rare (typically data-entry errors)
  //    and the log will show them as `scanned, not updated`.
  return original;
}

// Returns true when the value would actually change after sanitisation —
// useful as an early-exit so we don't issue an UPDATE for a no-op.
export function nricNeedsSanitising(value: string | null | undefined): boolean {
  if (value == null) return false;
  return NRIC_RE.test(String(value).trim());
}

export function phoneNeedsSanitising(value: string | null | undefined): boolean {
  if (value == null) return false;
  // The value is sanitisable iff `sanitisePhone` would actually change it.
  // Instead of duplicating the logic, just run the helper and compare.
  const sanitised = sanitisePhone(value);
  return sanitised !== null && sanitised !== value;
}
