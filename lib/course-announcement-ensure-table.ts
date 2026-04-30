import pool from './db';

// Idempotent startup migration for the course announcements feature.
// Runs from instrumentation.ts so the new table exists on boot. Also
// handles the one-shot migration from the legacy `course_additional_document`
// table: existing uploaded files become file-only announcements, then the
// old table is dropped. Safe to re-run after the migration is complete.

const DDL = `
CREATE TABLE IF NOT EXISTS public.course_announcement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_run_id UUID NOT NULL REFERENCES public.course_run(id) ON DELETE CASCADE,
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
    ON public.course_announcement(course_run_id);
`;

const MIGRATE_FROM_LEGACY = `
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'course_additional_document') THEN
        INSERT INTO public.course_announcement (id, course_run_id, file_name, file_url, posted_by, created_at)
        SELECT id, course_run_id, file_name, file_url, uploaded_by, created_at
        FROM public.course_additional_document
        ON CONFLICT (id) DO NOTHING;

        DROP TABLE public.course_additional_document;
    END IF;
END $$;
`;

let ensurePromise: Promise<void> | null = null;

export function ensureCourseAnnouncementTable(): Promise<void> {
    if (!ensurePromise) {
        ensurePromise = (async () => {
            try {
                await pool.query(DDL);
                await pool.query(MIGRATE_FROM_LEGACY);
                console.log('[Announcements] course_announcement table ensured');
            } catch (err: any) {
                console.error('[Announcements] Failed to ensure course_announcement table:', err?.message ?? err);
                ensurePromise = null;
                throw err;
            }
        })();
    }
    return ensurePromise;
}
