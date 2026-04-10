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

// Phone: 8-digit Singapore number, first digit + 4 digits + 3 digits.
// Example: 96983371 → 9xxxx371
// Idempotency: same — must be 4 digits in the middle.
const PHONE_RE = /^(\d)(\d{4})(\d{3})$/;

export function sanitisePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  // Strip spaces / hyphens / leading +65 first so we sanitise the canonical form.
  const stripped = String(value).replace(/[\s\-]/g, '').replace(/^\+?65/, '');
  const m = stripped.match(PHONE_RE);
  if (!m) return value as string; // wrong shape (international, short, already sanitised)
  return `${m[1]}xxxx${m[3]}`;
}

// Returns true when the value would actually change after sanitisation —
// useful as an early-exit so we don't issue an UPDATE for a no-op.
export function nricNeedsSanitising(value: string | null | undefined): boolean {
  if (value == null) return false;
  return NRIC_RE.test(String(value).trim());
}

export function phoneNeedsSanitising(value: string | null | undefined): boolean {
  if (value == null) return false;
  const stripped = String(value).replace(/[\s\-]/g, '').replace(/^\+?65/, '');
  return PHONE_RE.test(stripped);
}
