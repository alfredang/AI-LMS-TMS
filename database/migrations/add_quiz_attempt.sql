-- Migration: quiz_attempt table for learner quiz scores
-- Each row is one completed attempt by one learner on one quiz. Quiz
-- definitions live on course.resource_links JSONB — the quiz_id here
-- points at the `id` field of the resource link (e.g. "rl_1775839542580").
--
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.quiz_attempt (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
    course_id      uuid NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
    quiz_id        text NOT NULL,   -- matches resource_link.id on the course
    score          integer NOT NULL,
    total          integer NOT NULL,
    answers        jsonb NOT NULL,  -- { questionId: selectedOptionIndex, ... }
    completed_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempt_user_course
    ON public.quiz_attempt(user_id, course_id);

CREATE INDEX IF NOT EXISTS idx_quiz_attempt_quiz_id
    ON public.quiz_attempt(quiz_id);

COMMENT ON TABLE public.quiz_attempt IS
  'Learner quiz attempts. Quiz definitions live on course.resource_links (JSONB); this table records one row per submission with the final score.';
