/**
 * Matching an employer-supplied course title to an LMS course.
 *
 * Employers fill the Company Application Excel by hand, copying the course name
 * from wherever they saw it — the SkillsFuture portal, an old brochure, an email.
 * That name frequently is not `course.title`. Real examples from our own data:
 *
 *   "WSQ - Process and Design FMEA (TGS-2023037830)"  → "Process and Design FMEA"
 *   "WSQ Technical Drawing with Autocad Course"       → "Technical Drawing with AutoCAD"
 *   "CASL - Statistical Process Control (SPC)…"       → "Statistical Process Control (SPC)…"
 *   "Create Copilot Chatbots and Agents…"             → "Business Process Automation with…"
 *
 * Four different failure modes: junk prefixes, junk suffixes, an embedded course
 * reference number, and a genuine rename. The first three are mechanical and are
 * handled here. The last needs a human to confirm, which is what
 * `scoreCourseTitleSimilarity` powers — it ranks near-misses so the admin can pick
 * the right run instead of being told to go fix the spreadsheet.
 *
 * Deliberately NOT auto-resolving on similarity alone: joined by run id, our
 * ssg_enrolments rows contain pairs like "DevOps Engineering on AWS" against
 * "AWS Certified Solutions Architect Associate Training". Titles that merely look
 * close are routinely different courses, and silently picking one enrols learners
 * in the wrong class and invoices the wrong fee. Similarity suggests; it never decides.
 */

/**
 * Strip funding/delivery-mode noise and punctuation so titles compare on their
 * meaningful words alone. "WSQ - Technical Drawing (AutoCAD)" → "technical drawing autocad".
 */
export function normalizeCourseTitle(value: unknown): string {
  return String(value || '')
    .replace(/\b(WSQ|VIRTUAL|EXTERNAL|HYBRID)\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Word-order-insensitive key: "A class" and "class A" produce the same key. */
export function courseTitleTokenKey(value: unknown): string {
  return normalizeCourseTitle(value).split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Pull an SSG course reference number out of free text.
 *
 * Employers often paste the SkillsFuture course name, which carries the TGS code
 * with it — "WSQ - Process and Design FMEA (TGS-2023037830)". When it's there it
 * is a far better key than any amount of title matching: it's exact, and it
 * survives renames.
 */
export function extractCourseReferenceNumber(value: unknown): string | null {
  const match = String(value || '').match(/\bTGS-[A-Z0-9]{6,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * The established match rule: identical, one containing the other, or the same
 * words in any order. Exact-ish only — this is what may resolve without a human.
 */
export function courseTitlesMatch(a: unknown, b: unknown): boolean {
  const na = normalizeCourseTitle(a);
  const nb = normalizeCourseTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ka = courseTitleTokenKey(a);
  return !!ka && ka === courseTitleTokenKey(b);
}

/**
 * Filler words carry no signal about which course this is, but they inflate the
 * denominator and let unrelated titles score as "similar".
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
  'your', 'you', 'use', 'using', 'its', 'course', 'training', 'certified', 'certificate',
]);

/**
 * Crude suffix stemmer. Course titles describe the same thing in different parts
 * of speech — "Automate Business Processes" vs "Business Process Automation" —
 * and without stemming those score as barely related. Iterates to a fixed point
 * so "process"/"processes" and "automate"/"automation" land on the same stem.
 */
function stem(word: string): string {
  let w = word;
  for (let i = 0; i < 4; i++) {
    if (w.length <= 3) break;
    const next = w
      .replace(/ation$/, 'at')
      .replace(/ing$/, '')
      .replace(/es$/, '')
      .replace(/s$/, '')
      .replace(/e$/, '');
    if (next === w || next.length < 3) break;
    w = next;
  }
  return w;
}

function contentTokens(value: unknown): Set<string> {
  return new Set(
    normalizeCourseTitle(value)
      .split(' ')
      .filter(t => t && !STOPWORDS.has(t))
      .map(stem),
  );
}

/**
 * 0..1 similarity for RANKING SUGGESTIONS ONLY — never for auto-selection.
 * Dice coefficient over stemmed content words: forgiving about word order, part
 * of speech, and filler, which is how these titles actually drift.
 */
export function scoreCourseTitleSimilarity(a: unknown, b: unknown): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
