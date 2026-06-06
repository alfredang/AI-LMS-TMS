-- Training-Provider-level "Briefing on Assessment" template text.
-- Set once by the Training Provider; shown to learners & trainers in the
-- Assessment area of every course detail page. When empty, CourseDetail falls
-- back to the standard assessment briefing.

BEGIN;

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS briefing_on_assessment text;

COMMIT;
