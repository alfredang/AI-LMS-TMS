import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/**
 * The course fields whose changes are recorded in the Course Change Control log.
 *
 * Deliberately a curated list rather than "every column": the log is a record of
 * what changed about the COURSE as a registered offering -- its identity, its
 * shape and its funding -- not an edit history of every URL and checkbox. Adding
 * courseware links here would bury a code renewal under a dozen link touch-ups.
 *
 * Keys are the camelCase names the update API receives; labels are what the UI
 * shows in the "Detail of change" column.
 */
const TRACKED_FIELDS: Record<string, string> = {
  title: 'Course Title',
  courseCode: 'Course Code (Original)',
  newCourseCode: 'Course Code (Current)',
  courseType: 'Course Type',
  trainingHours: 'Training Hours',
  assessmentHours: 'Assessment Hours',
  courseFee: 'Course Fee',
  fundingValidity: 'Funding Validity',
  renewedStatus: 'Renewal Status',
  tscTitle: 'TSC Title',
  tscCode: 'TSC Code',
};

/** The DB column backing each tracked field, for reading the pre-update values. */
const FIELD_COLUMNS: Record<string, string> = {
  title: 'title',
  courseCode: 'course_code',
  newCourseCode: 'new_course_code',
  courseType: 'course_type',
  trainingHours: 'training_hours',
  assessmentHours: 'assessment_hours',
  courseFee: 'course_fee',
  fundingValidity: 'funding_validity',
  renewedStatus: 'renewed_status',
  tscTitle: 'tsc_title',
  tscCode: 'tsc_code',
};

/**
 * Normalise a value to the text form stored in the log.
 *
 * Everything is compared as trimmed text so that a numeric 8 and the string '8',
 * or a date and its ISO string, do not register as a change. Empty string and
 * null both mean "unset" and collapse to null, so clearing an already-empty
 * field logs nothing.
 */
function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (s === '') return null;
  // Dates arrive as full timestamps from the DB but as yyyy-mm-dd from the form;
  // compare on the date part alone so a save with no edit is not logged.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T[\d:.]+/);
  return m ? m[1] : s;
}

export interface ChangeAuthor {
  userId?: string | null;
  userName?: string | null;
}

/**
 * Record every tracked field that differs between the course's current stored
 * row and the incoming update, as one log row per field.
 *
 * MUST be called inside the same transaction as the UPDATE and BEFORE it runs --
 * it reads the pre-update values to compute the "from" side.
 *
 * Logging is best-effort by design: a failure here must never abort a course
 * save. The caller wraps it so an audit problem cannot cost the user their edit.
 */
export async function recordCourseChanges(
  db: Queryable,
  courseId: string,
  incoming: Record<string, any>,
  author: ChangeAuthor = {},
  note?: string
): Promise<number> {
  const fields = Object.keys(TRACKED_FIELDS).filter(f => incoming[f] !== undefined);
  if (fields.length === 0) return 0;

  const cols = fields.map(f => FIELD_COLUMNS[f]);
  const { rows } = await db.query(
    `SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM public.course WHERE id = $1`,
    [courseId]
  );
  if (rows.length === 0) return 0;
  const before = rows[0];

  const changed = fields
    .map(f => ({ field: f, from: norm(before[FIELD_COLUMNS[f]]), to: norm(incoming[f]) }))
    .filter(c => c.from !== c.to)
    // A blank incoming value means "not supplied" for the renewed code -- the
    // update statement leaves the stored value alone, so logging a change to
    // null here would claim an edit that never happened.
    .filter(c => !(c.field === 'newCourseCode' && c.to === null));

  for (const c of changed) {
    await db.query(
      `INSERT INTO public.course_change_log
         (course_id, field, field_label, old_value, new_value, changed_by, changed_by_name, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        courseId,
        c.field,
        TRACKED_FIELDS[c.field],
        c.from,
        c.to,
        author.userId || null,
        author.userName || null,
        note || null,
      ]
    );
  }

  return changed.length;
}
