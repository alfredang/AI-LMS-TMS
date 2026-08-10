-- course_code_at(course_id, at): the course reference code that was in force at
-- a given moment.
--
-- Records display the code that was TRUE WHEN THEY WERE CREATED: an enrolment
-- submitted to SSG in 2024 under TGS-2020503676 keeps showing TGS-2020503676,
-- while a class created after the 2026 renewal shows TGS-2026064719 -- even
-- though both hang off the same course row and stay fully traceable through it.
-- Displaying only the current code made old records look renumbered; displaying
-- only the original made new records look stale. This function gives each
-- record the code of its own era.
--
-- Resolution, most reliable signal first:
--   1. A history row whose known validity period covers the date.
--   2. For backfilled rows with no dates at all: the superseded code, when the
--      record predates the renewal being recorded (the history row's
--      created_at). The exact renewal day is unknown for these, so the day the
--      renewal was recorded is the best available boundary.
--   3. The current code (also covers dates after every known period).
--   4. The legacy course.course_code, for a course with no history rows.
--
-- READ-ONLY and additive: nothing writes, nothing moves, no existing column or
-- row is touched. Purely a display-time resolver.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run.

CREATE OR REPLACE FUNCTION public.course_code_at(p_course_id uuid, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT code FROM (
    -- 1. a row whose known validity period covers the date
    SELECT h.code, 1 AS pri, h.valid_from
      FROM public.course_code_history h
     WHERE h.course_id = p_course_id
       AND (h.valid_from IS NOT NULL OR h.valid_to IS NOT NULL)
       AND (h.valid_from IS NULL OR h.valid_from <= p_at::date)
       AND (h.valid_to   IS NULL OR h.valid_to   >= p_at::date)
    UNION ALL
    -- 2. undated superseded code, for records that predate the renewal record
    SELECT h.code, 2, h.valid_from
      FROM public.course_code_history h
     WHERE h.course_id = p_course_id
       AND h.valid_from IS NULL AND h.valid_to IS NULL AND NOT h.is_current
       AND p_at < (SELECT min(h2.created_at) FROM public.course_code_history h2
                    WHERE h2.course_id = p_course_id AND h2.is_current)
    UNION ALL
    -- 3. the code currently in force
    SELECT h.code, 3, h.valid_from
      FROM public.course_code_history h
     WHERE h.course_id = p_course_id AND h.is_current
    UNION ALL
    -- 4. legacy fallback for a course with no history rows
    SELECT c.course_code, 4, NULL::date
      FROM public.course c
     WHERE c.id = p_course_id AND NULLIF(c.course_code, '') IS NOT NULL
  ) x
  -- On a boundary day two periods can both match; the later code wins.
  ORDER BY pri, valid_from DESC NULLS LAST
  LIMIT 1
$$;

COMMENT ON FUNCTION public.course_code_at(uuid, timestamptz) IS
    'The course reference code in force at a given moment. Used so each record displays the code of its own era; read-only display resolver, never used for writes.';
