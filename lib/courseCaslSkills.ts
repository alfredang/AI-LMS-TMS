/**
 * CASL courses are SSG-approved, TGS-coded non-WSQ courses. They are not mapped
 * to a Skills Framework TSC, so they carry no TSC Title / TSC Code. What used to
 * be typed into "TSC Title" for them is the skill area the course covers, which
 * now lives in its own `course.casl_skills` column. The TSC fields on a CASL
 * course are stored as this placeholder so every surface shows them as absent.
 */
export const CASL_NO_TSC = 'NA';

/**
 * Resolve the TSC / CASL Skills values to store for a course of `courseType`.
 *
 * For CASL the TSC fields are forced to the placeholder. A caller that still
 * sends its skill area as `tscTitle` (older clients, agents posting to
 * /api/admin/add-course) has it carried into CASL Skills rather than dropped.
 * For every other type the values pass through unchanged.
 */
export function resolveTscFields(input: {
  courseType?: string | null;
  tscTitle?: string | null;
  tscCode?: string | null;
  caslSkills?: string | null;
}): { tscTitle: string | null; tscCode: string | null; caslSkills: string | null } {
  const clean = (v?: string | null) => {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
  };
  const isPlaceholder = (v: string | null) => !v || /^(n\/?a|-)$/i.test(v);

  if (input.courseType === 'CASL') {
    const legacyTitle = clean(input.tscTitle);
    return {
      tscTitle: CASL_NO_TSC,
      tscCode: CASL_NO_TSC,
      caslSkills: clean(input.caslSkills) ?? (isPlaceholder(legacyTitle) ? null : legacyTitle),
    };
  }
  return { tscTitle: clean(input.tscTitle), tscCode: clean(input.tscCode), caslSkills: clean(input.caslSkills) };
}
