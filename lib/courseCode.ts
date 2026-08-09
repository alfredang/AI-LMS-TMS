import type { Pool, PoolClient } from 'pg';
import pool from './db';

type Queryable = Pool | PoolClient;

/**
 * Resolve a course reference code to a course id.
 *
 * SSG funding renewal issues a NEW reference code for what is still the same
 * course, so a code arriving from SSG, the storefront or a bulk upload may be
 * the current code, the code it replaced, or one from an earlier renewal.
 * `course_code_history` holds every code a course has ever carried, with a
 * unique index on (code), so any of them resolves to exactly one course.
 *
 * Falls back to the legacy course.course_code / new_course_code columns so a
 * course created before the backfill still resolves.
 *
 * Returns null when the code is unknown -- callers that auto-create a course on
 * a miss MUST use this rather than a bare `WHERE course_code = $1`, or a renewed
 * code will create a duplicate course record and split its history.
 */
export async function resolveCourseIdByCode(
  code: string,
  db: Queryable = pool
): Promise<string | null> {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) return null;

  const { rows } = await db.query(
    `SELECT c.id
       FROM public.course c
      WHERE c.id = (SELECT h.course_id FROM public.course_code_history h WHERE h.code = $1)
         OR c.course_code = $1
         OR NULLIF(c.new_course_code, '') = $1
      LIMIT 1`,
    [trimmed]
  );
  return rows[0]?.id ?? null;
}

/**
 * The code currently in force for a course, falling back to the legacy columns.
 * Use when emitting a code outward (SSG submissions, storefront SKUs, invoices).
 */
export async function currentCodeForCourse(
  courseId: string,
  db: Queryable = pool
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT COALESCE(
              (SELECT h.code FROM public.course_code_history h
                WHERE h.course_id = c.id AND h.is_current LIMIT 1),
              NULLIF(c.new_course_code, ''),
              c.course_code
            ) AS code
       FROM public.course c
      WHERE c.id = $1
      LIMIT 1`,
    [courseId]
  );
  return rows[0]?.code ?? null;
}

/**
 * Resolve a course by any title it has ever carried, current or former.
 *
 * Unlike codes, titles are not globally unique -- two genuinely different courses
 * may share one (an Associate and a Professional variant registered under the
 * same marketing name). This returns ALL matches; a caller that needs exactly one
 * course must disambiguate (usually by code) rather than assuming the first.
 */
export async function resolveCourseIdsByTitle(
  title: string,
  db: Queryable = pool
): Promise<string[]> {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) return [];

  const { rows } = await db.query(
    `SELECT DISTINCT c.id
       FROM public.course c
      WHERE lower(c.title) = lower($1)
         OR c.id IN (SELECT h.course_id FROM public.course_title_history h
                      WHERE lower(h.title) = lower($1))`,
    [trimmed]
  );
  return rows.map(r => r.id);
}

/**
 * Record a course rename: the new title becomes current and the previous title is
 * retained so past records stay findable under it. Enrolments are never touched --
 * they hang off course_id and are unaffected by a rename.
 *
 * Idempotent -- renaming to the title that is already current is a no-op.
 */
export async function recordRenamedTitle(
  courseId: string,
  newTitle: string,
  validFrom: string | null,
  db: Queryable = pool
): Promise<void> {
  const trimmed = typeof newTitle === 'string' ? newTitle.trim() : '';
  if (!trimmed) return;

  await db.query(
    `UPDATE public.course_title_history
        SET is_current = false,
            valid_to   = COALESCE(valid_to, ($2::date - 1)),
            updated_at = now()
      WHERE course_id = $1 AND is_current AND lower(title) <> lower($3)`,
    [courseId, validFrom, trimmed]
  );

  await db.query(
    `INSERT INTO public.course_title_history (course_id, title, valid_from, is_current)
     VALUES ($1, $2, $3::date, true)
     ON CONFLICT (course_id, lower(title)) DO UPDATE
        SET is_current = true,
            valid_from = COALESCE(EXCLUDED.valid_from, public.course_title_history.valid_from),
            valid_to   = NULL,
            updated_at = now()`,
    [courseId, trimmed, validFrom]
  );

  await db.query(
    `UPDATE public.course SET title = $2, updated_at = now() WHERE id = $1`,
    [courseId, trimmed]
  );
}

/**
 * Record a renewed code for a course: the incoming code becomes current and the
 * previous current code is retained as history. Idempotent -- re-recording the
 * code that is already current is a no-op.
 *
 * `validFrom` dates the new code; the superseded row is closed out the day
 * before, when it has no end date yet.
 */
export async function recordRenewedCode(
  courseId: string,
  newCode: string,
  validFrom: string | null,
  db: Queryable = pool
): Promise<void> {
  const trimmed = typeof newCode === 'string' ? newCode.trim() : '';
  if (!trimmed) return;

  await db.query(
    `UPDATE public.course_code_history
        SET is_current = false,
            valid_to   = COALESCE(valid_to, ($2::date - 1)),
            updated_at = now()
      WHERE course_id = $1 AND is_current AND code <> $3`,
    [courseId, validFrom, trimmed]
  );

  await db.query(
    `INSERT INTO public.course_code_history (course_id, code, valid_from, is_current)
     VALUES ($1, $2, $3::date, true)
     ON CONFLICT (code) DO UPDATE
        SET course_id  = EXCLUDED.course_id,
            valid_from = COALESCE(EXCLUDED.valid_from, public.course_code_history.valid_from),
            is_current = true,
            updated_at = now()`,
    [courseId, trimmed, validFrom]
  );
}
