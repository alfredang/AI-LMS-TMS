-- Course change log: one row per field value change, in chronological order.
--
-- course_code_history and course_title_history each track ONE field and answer
-- "which codes/titles has this course carried". They deliberately model validity
-- periods, not edits. Neither can answer "what changed on this course, when" for
-- anything else -- a fee correction, a change in training hours or a funding
-- validity extension leaves no trace at all.
--
-- This table is the general answer: every tracked field writes an old -> new row
-- with the timestamp of the edit and, where known, who made it. It is an APPEND-
-- ONLY audit log -- rows are never updated or deleted, and nothing reads it to
-- decide behaviour, so a gap or a duplicate here can never corrupt course data.
--
-- It does NOT replace the two history tables. Those remain the source of truth
-- for resolving a code or title back to a course (a code carries a unique index
-- that makes that lookup unambiguous); this one is the human-readable narrative.
--
-- Only changes made from the point this ships are recorded. Past edits were not
-- captured anywhere and cannot be reconstructed -- inventing dates for them would
-- put fabricated facts in an audit log, so they are simply absent.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.course_change_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id    uuid NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
    -- The course field that changed, as the API's camelCase name (e.g. 'courseFee').
    field        text NOT NULL,
    -- Human-readable label shown in the UI (e.g. 'Course Fee').
    field_label  text NOT NULL,
    -- Values are stored as TEXT rather than typed columns: the log spans numeric,
    -- date and text fields, and it only ever needs to render them, never compute
    -- on them. NULL means the field was previously unset / was cleared.
    old_value    text,
    new_value    text,
    changed_at   timestamptz NOT NULL DEFAULT now(),
    -- Who made the edit. Nullable: machine callers (SSG sync, scheduler) have no
    -- user, and the FK is ON DELETE SET NULL so removing a user never deletes
    -- audit history.
    changed_by   uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
    changed_by_name text,
    -- Free-text context, e.g. 'funding renewal', 'SSG sync'.
    note         text
);

-- The page reads one course's log newest-first; this index serves that directly.
CREATE INDEX IF NOT EXISTS course_change_log_course_id_changed_at_idx
    ON public.course_change_log (course_id, changed_at DESC);

-- Supports filtering the whole log down to a single field across courses.
CREATE INDEX IF NOT EXISTS course_change_log_field_idx
    ON public.course_change_log (field);

-- Backfill the code and title changes already captured in the two history
-- tables, so the change log opens with the history that IS known rather than
-- empty. Only genuine transitions are seeded: the first value a course carried
-- is its original, not a change, so it is skipped via the lag() being non-null.
--
-- changed_at uses the successor's valid_from, else the day after the predecessor
-- closed. Where neither exists the date is genuinely unknown; those rows are
-- still recorded (the change did happen) with changed_at left at the epoch
-- sentinel and note marking it, so the UI can say "date not recorded" instead of
-- inventing one. changed_by is NULL -- these predate any per-user attribution.
--
-- ON CONFLICT DO NOTHING against a natural-key index keeps re-runs idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS course_change_log_backfill_key
    ON public.course_change_log (course_id, field, COALESCE(old_value, ''), COALESCE(new_value, ''))
    WHERE note IN ('backfill: course_code_history', 'backfill: course_title_history');

INSERT INTO public.course_change_log
    (course_id, field, field_label, old_value, new_value, changed_at, note)
SELECT course_id, 'courseCode', 'Course Code', prev_code, code,
       COALESCE(valid_from::timestamptz, (prev_valid_to + 1)::timestamptz, 'epoch'::timestamptz),
       'backfill: course_code_history'
FROM (
    SELECT h.course_id, h.code, h.valid_from,
           lag(h.code)     OVER w AS prev_code,
           lag(h.valid_to) OVER w AS prev_valid_to
      FROM public.course_code_history h
    WINDOW w AS (PARTITION BY h.course_id
                 ORDER BY h.is_current, COALESCE(h.valid_from, h.valid_to, h.created_at::date), h.code)
) s
WHERE prev_code IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.course_change_log
    (course_id, field, field_label, old_value, new_value, changed_at, note)
SELECT course_id, 'title', 'Course Title', prev_title, title,
       COALESCE(valid_from::timestamptz, (prev_valid_to + 1)::timestamptz, 'epoch'::timestamptz),
       'backfill: course_title_history'
FROM (
    SELECT t.course_id, t.title, t.valid_from,
           lag(t.title)    OVER w AS prev_title,
           lag(t.valid_to) OVER w AS prev_valid_to
      FROM public.course_title_history t
    WINDOW w AS (PARTITION BY t.course_id
                 ORDER BY t.is_current, COALESCE(t.valid_from, t.valid_to, t.created_at::date), t.title)
) s
WHERE prev_title IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.course_change_log IS
    'Append-only audit of course field changes (old -> new, when, by whom). Read-only narrative; course_code_history and course_title_history remain the source of truth for resolving codes and titles.';
COMMENT ON COLUMN public.course_change_log.old_value IS
    'Previous value as text; NULL when the field was not previously set.';
