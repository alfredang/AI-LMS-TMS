-- Course code history: one course, many codes over time.
--
-- SSG funding is renewed every 2-3 years and each renewal issues a NEW course
-- reference code for what is still the SAME course. The previous model kept at
-- most two codes on the course row (course_code + new_course_code), which caps
-- out on the second renewal and leaves no way to resolve a code from an earlier
-- era back to its course.
--
-- This table records every code a course has ever carried, so history stays
-- retrievable by ANY of them. The legacy course.course_code / new_course_code
-- columns are deliberately left in place and untouched: existing reads keep
-- working while call sites migrate over to this table.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.course_code_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   uuid NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
    code        text NOT NULL,
    valid_from  date,
    valid_to    date,
    is_current  boolean NOT NULL DEFAULT false,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A code identifies exactly one course. This is the constraint that makes
-- "look up any old code -> get the course" unambiguous, and it will reject a
-- future attempt to hand the same code to two different course rows.
CREATE UNIQUE INDEX IF NOT EXISTS course_code_history_code_key
    ON public.course_code_history (code);

CREATE INDEX IF NOT EXISTS course_code_history_course_id_idx
    ON public.course_code_history (course_id);

-- At most one current code per course.
CREATE UNIQUE INDEX IF NOT EXISTS course_code_history_one_current_idx
    ON public.course_code_history (course_id)
    WHERE is_current;

COMMENT ON TABLE public.course_code_history IS
    'Every course reference code a course has carried. Funding renewal issues a new code for the same course; all prior codes remain resolvable here.';
COMMENT ON COLUMN public.course_code_history.is_current IS
    'True for the code currently in force. At most one per course.';
