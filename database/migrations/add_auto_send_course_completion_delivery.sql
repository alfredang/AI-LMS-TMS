-- Adds an idempotency table for course-completion email delivery.
-- The primary key is one logical delivery attempt:
-- course run + enrollment + learner email + course completion template.

CREATE TABLE IF NOT EXISTS public.auto_send_course_completion_delivery (
    delivery_key text PRIMARY KEY,
    run_id text NOT NULL,
    course_run_id text,
    enrollment_id uuid,
    learner_email text,
    status text NOT NULL DEFAULT 'sending',
    error_message text,
    claimed_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.auto_send_course_completion_delivery
    ADD COLUMN IF NOT EXISTS enrollment_id uuid,
    ADD COLUMN IF NOT EXISTS error_message text,
    ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
