-- Chariot production compatibility for the 2026-09-15 application release.
-- Forward-only and idempotent: safe to run on both patched and unpatched
-- Chariot databases. Existing rows and values are left unchanged.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS favorite_trainers text;

ALTER TABLE public.company_application
    ADD COLUMN IF NOT EXISTS attention_ignored_at timestamp with time zone;

COMMIT;
