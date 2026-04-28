-- Create the course_additional_document table for trainer-uploaded materials
-- Safe to re-run — uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS course_additional_document (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_additional_document_course_run_id
    ON course_additional_document(course_run_id);
