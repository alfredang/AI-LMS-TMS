-- Stores SSG enrolment records pulled by the scheduler.
-- Only new enrolments (by enrolment_reference) are inserted; existing ones are skipped.
CREATE TABLE IF NOT EXISTS public.ssg_enrolment_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrolment_reference TEXT NOT NULL,
    enrolment_date DATE,
    learner_name TEXT,
    learner_nric TEXT,
    learner_email TEXT,
    course_title TEXT,
    course_ref_code TEXT,
    course_run_id TEXT,
    start_date DATE,
    status TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssg_enrolment_record_ref
    ON public.ssg_enrolment_record(enrolment_reference);
CREATE INDEX IF NOT EXISTS idx_ssg_enrolment_record_date
    ON public.ssg_enrolment_record(enrolment_date DESC);
