/**
 * Sanitize Google Docs/Drive/Sheets/Slides share links so they open reliably
 * for everyone — including trainers/learners who are signed into multiple
 * Google accounts in the same browser.
 *
 * The problem: links copied from the Drive "Share" dialog often carry an
 * `ouid=<owner account id>` param and/or a `/u/<n>/` path segment. When a
 * viewer signed into multiple Google accounts opens such a link, Google routes
 * it to the wrong account slot (e.g. `/u/2/`) and shows
 * "Sorry, unable to open the file at this time." Stripping these makes Google
 * resolve the file by its ID under whichever account (or anonymously) actually
 * has access.
 *
 * Non-Google URLs (and empty/invalid input) are returned unchanged.
 */
export function sanitizeGoogleLink(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return url ?? '';
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed; // not a parseable URL — leave as-is
  }

  if (!/(^|\.)google\.com$/i.test(parsed.hostname)) return trimmed;

  // Drop the `/u/<n>/` account-slot segment if present.
  parsed.pathname = parsed.pathname.replace(/\/u\/\d+\//, '/');

  // Drop params that pin the link to a specific owner/account or upload format.
  for (const param of ['ouid', 'usp', 'rtpof', 'sd']) {
    parsed.searchParams.delete(param);
  }

  return parsed.toString();
}
