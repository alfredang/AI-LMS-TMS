/**
 * One display convention for course codes everywhere a course is listed.
 *
 * A renewed course has two codes: the ORIGINAL registration code (what its past
 * enrolments and SSG records were created under) and the CURRENT code issued at
 * funding renewal. Showing only one of them keeps causing confusion -- the
 * current code alone looks like the original vanished, the original alone looks
 * stale -- so listings show both: the code in force first, then the original.
 *
 *   renewed:      "TGS-2026064719 (orig TGS-2020503676)"
 *   never renewed:"TGS-2020504243"
 *
 * Accepts the loose shapes the various endpoints return; any of the three
 * fields may be absent.
 */
export function displayCourseCodes(c: {
  courseCode?: string | null;
  newCourseCode?: string | null;
  currentCourseCode?: string | null;
}): string {
  const original = (c.courseCode || '').trim();
  const current = (c.currentCourseCode || c.newCourseCode || '').trim() || original;
  if (!current) return '—';
  return original && original !== current ? `${current} (orig ${original})` : current;
}
