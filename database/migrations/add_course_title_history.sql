-- Course title history: one course, many titles over time.
--
-- A course can be renamed (rebrand, syllabus refresh, SSG re-registration) while
-- remaining the same course with the same enrolments and learner records. Without
-- a record of the previous titles, a past record found under the old name looks
-- like it belongs to a course that no longer exists -- and searching by the old
-- title returns nothing.
--
-- This is the title counterpart to course_code_history. Together they mean a
-- course stays findable by ANY code or ANY title it has ever carried, while all
-- enrolments/runs/assessments stay attached by course_id and are never moved.
--
-- Unlike codes, titles are NOT globally unique: two genuinely different courses
-- may legitimately share a title (e.g. an Associate and a Professional variant
-- registered under the same marketing name). So there is no unique index on
-- title -- only one current title per course.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.course_title_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   uuid NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
    title       text NOT NULL,
    valid_from  date,
    valid_to    date,
    is_current  boolean NOT NULL DEFAULT false,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_title_history_course_id_idx
    ON public.course_title_history (course_id);

-- Case-insensitive lookup by any past title.
CREATE INDEX IF NOT EXISTS course_title_history_title_lower_idx
    ON public.course_title_history (lower(title));

-- The same title must not be recorded twice for one course.
CREATE UNIQUE INDEX IF NOT EXISTS course_title_history_course_title_key
    ON public.course_title_history (course_id, lower(title));

-- At most one current title per course.
CREATE UNIQUE INDEX IF NOT EXISTS course_title_history_one_current_idx
    ON public.course_title_history (course_id)
    WHERE is_current;

COMMENT ON TABLE public.course_title_history IS
    'Every title a course has carried. A renamed course keeps its enrolments and stays findable by its former titles.';

-- Backfill the current title for every course.
INSERT INTO public.course_title_history (course_id, title, is_current, note)
SELECT c.id, c.title, true, 'backfill: course.title'
FROM public.course c
WHERE NULLIF(c.title, '') IS NOT NULL
ON CONFLICT (course_id, lower(title)) DO NOTHING;
