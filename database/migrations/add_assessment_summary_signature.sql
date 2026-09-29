-- E-signing of the Assessment Summary Record (ASR).
--
-- The learner and the trainer each sign the ASR from the course page: the
-- learner records their name / NRIC / drawn signature once (learner_signature,
-- the learner counterpart of trainer_assessor_signature) and the trainer reuses
-- their assessor block. Each signing snapshots the party's details on the
-- per-enrolment assessment_summary_record row and regenerates the PDF from the
-- course's ASR template (course.assessment_summary_record_url) with every
-- block that has been signed so far, uploading it to the learner's Assessment
-- Records folder in Google Drive. The final PDF therefore carries both the
-- Candidate and the Assessor name, NRIC, signature and date.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.learner_signature (
    user_id        uuid PRIMARY KEY REFERENCES public.app_user(id) ON DELETE CASCADE,
    learner_name   text NOT NULL,
    nric           text NOT NULL DEFAULT '',
    -- PNG data URL (data:image/png;base64,...) captured from the signature pad
    signature_png  text,
    created_at     timestamp with time zone DEFAULT now() NOT NULL,
    updated_at     timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.learner_signature IS
    'Per-learner candidate block (name / NRIC / drawn signature) stamped onto the Assessment Summary Record.';

CREATE TABLE IF NOT EXISTS public.assessment_summary_record (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_run_id          uuid NOT NULL REFERENCES public.course_run(id) ON DELETE CASCADE,
    learner_user_id        uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
    -- Candidate block, snapshotted when the learner signs
    learner_name           text,
    learner_nric           text,
    learner_sign_date      date,
    learner_signature_png  text,
    learner_signed_at      timestamp with time zone,
    -- Assessor block, snapshotted when the trainer signs
    trainer_user_id        uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
    trainer_name           text,
    trainer_nric           text,
    trainer_sign_date      date,
    trainer_signature_png  text,
    trainer_signed_at      timestamp with time zone,
    -- Generated PDF in the learner's Assessment Records folder
    template_file_id       text,
    file_id                text,
    file_url               text,
    file_name              character varying(255),
    generated_at           timestamp with time zone,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assessment_summary_record_run_learner_key UNIQUE (course_run_id, learner_user_id)
);

COMMENT ON TABLE public.assessment_summary_record IS
    'Per-enrolment Assessment Summary Record e-signing state: candidate + assessor blocks and the generated signed PDF.';

CREATE INDEX IF NOT EXISTS idx_assessment_summary_record_run
    ON public.assessment_summary_record (course_run_id);
