-- Track which feedback responses have been compiled into the daily
-- 6:30 PM class-evaluation email to the trainer(s).
-- NULL = not yet included in any trainer evaluation email.
-- Idempotent: safe to run multiple times.

ALTER TABLE public.feedback_form_response
    ADD COLUMN IF NOT EXISTS trainer_emailed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_feedback_response_trainer_emailed
    ON public.feedback_form_response(trainer_emailed_at)
    WHERE trainer_emailed_at IS NULL;
