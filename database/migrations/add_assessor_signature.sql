-- Assessor sign-off on learner assessment submissions.
--
-- The trainer records their assessor details once (name, NRIC, date, a
-- mouse-drawn signature) in a dialog on Trainer > Assessment Grading. Ticking
-- the "SIG" box beside a learner then stamps those details onto every file the
-- learner submitted (PDF or DOCX): the stamped copy is uploaded to Google Drive
-- next to the original and becomes the submission's file_url; the original
-- link is kept so the stamp can be undone.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.trainer_assessor_signature (
    user_id        uuid PRIMARY KEY REFERENCES public.app_user(id) ON DELETE CASCADE,
    assessor_name  text NOT NULL,
    nric           text NOT NULL DEFAULT '',
    sign_date      date NOT NULL DEFAULT CURRENT_DATE,
    -- PNG data URL (data:image/png;base64,...) captured from the signature pad
    signature_png  text,
    created_at     timestamp with time zone DEFAULT now() NOT NULL,
    updated_at     timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.trainer_assessor_signature IS
    'Per-trainer assessor block (name / NRIC / date / drawn signature) stamped onto learner assessment submissions.';

ALTER TABLE public.link_assessment_submission
    ADD COLUMN IF NOT EXISTS assessor_signed_at timestamp with time zone;
ALTER TABLE public.link_assessment_submission
    ADD COLUMN IF NOT EXISTS assessor_signed_by uuid;
ALTER TABLE public.link_assessment_submission
    ADD COLUMN IF NOT EXISTS original_file_url text;
ALTER TABLE public.link_assessment_submission
    ADD COLUMN IF NOT EXISTS original_file_name character varying(255);

COMMENT ON COLUMN public.link_assessment_submission.assessor_signed_at IS
    'When the assessor block was stamped onto this file (NULL = unsigned).';
COMMENT ON COLUMN public.link_assessment_submission.assessor_signed_by IS
    'app_user.id of the trainer whose assessor details were stamped.';
COMMENT ON COLUMN public.link_assessment_submission.original_file_url IS
    'Learner''s unstamped upload; file_url points at the stamped copy while signed.';
