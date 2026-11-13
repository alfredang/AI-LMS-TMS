// A unit titled just "Lab"/"Labs" only points at lab material, which learners open
// from Courseware > Activities/Lab. For every course type it is hidden from the Lesson
// section and left out of progress. The row itself stays, so it still shows in the editor.
export const isLabsUnit = (title?: string | null): boolean => /^\s*labs?\s*$/i.test(title ?? '');

// SQL twin of isLabsUnit, for queries that alias learning_unit as `lu`. Fixed string.
export const NOT_LABS_UNIT_SQL = String.raw`lu.title !~* '^\s*labs?\s*$'`;
