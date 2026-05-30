-- Customizable learner feedback form (replaces/augments TRAQOM external survey).
-- Adds: feedback_form_template (one per training_provider), feedback_form_response (per submission),
-- plus two columns on training_provider to gate the new card on CourseDetail.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feedback_form_template (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    training_provider_id uuid REFERENCES public.training_provider(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT 'Course Feedback',
    sections jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_form_template_provider
    ON public.feedback_form_template(training_provider_id);

CREATE TABLE IF NOT EXISTS public.feedback_form_response (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid REFERENCES public.feedback_form_template(id) ON DELETE SET NULL,
    course_run_id uuid REFERENCES public.course_run(id) ON DELETE SET NULL,
    user_id uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
    learner_email text,
    learner_name text,
    answers jsonb NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_response_course_run
    ON public.feedback_form_response(course_run_id);
CREATE INDEX IF NOT EXISTS idx_feedback_response_submitted
    ON public.feedback_form_response(submitted_at);

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS feedback_form_enabled boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS feedback_form_external_link text;

COMMIT;
