-- Create course_announcement table — replaces course_additional_document.
-- An announcement is one trainer-posted item visible to all learners in the course run.
-- It can include any combination of: a message, a link URL, and a file attachment.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS course_announcement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
    title TEXT,
    message TEXT,
    link_url TEXT,
    file_name TEXT,
    file_url TEXT,
    posted_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT course_announcement_has_content
        CHECK (
            COALESCE(NULLIF(TRIM(message), ''), NULLIF(TRIM(link_url), ''), NULLIF(file_url, '')) IS NOT NULL
        )
);

CREATE INDEX IF NOT EXISTS idx_course_announcement_course_run_id
    ON course_announcement(course_run_id);

-- One-shot migration of any existing course_additional_document rows into announcements
-- as file-only posts, then drop the legacy table.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'course_additional_document') THEN
        INSERT INTO course_announcement (id, course_run_id, file_name, file_url, posted_by, created_at)
        SELECT id, course_run_id, file_name, file_url, uploaded_by, created_at
        FROM course_additional_document
        ON CONFLICT (id) DO NOTHING;

        DROP TABLE course_additional_document;
    END IF;
END $$;
