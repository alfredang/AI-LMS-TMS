-- Migration: add_microsoft_redeem_tables
-- Backs the Admin > Certificate > "Microsoft Certificate" tool, migrated
-- from the standalone `microsoftredeemcode` Flask/Playwright app.
--
-- microsoft_redeem_session — single-row table holding the Playwright
--   storageState (Microsoft Learn auth cookies). Replaces the original
--   file-based storage_state.json so the session survives container
--   redeploys on Coolify (ephemeral filesystem).
--
-- microsoft_redeem_code — history of every generated achievement code.
--   Replaces the original codes.csv.
--
-- These tables are also created on first use by lib/microsoft-redeem/db.ts
-- (CREATE TABLE IF NOT EXISTS), so the feature works without running this
-- migration; the migration is provided for explicit, ordered provisioning.

CREATE TABLE IF NOT EXISTS public.microsoft_redeem_session (
    id              integer PRIMARY KEY DEFAULT 1,
    storage_state   jsonb NOT NULL,
    signed_in_email text,
    updated_at      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT microsoft_redeem_session_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS public.microsoft_redeem_code (
    id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    course_number text NOT NULL,
    course_title  text,
    code          text NOT NULL,
    url           text,
    students      integer NOT NULL DEFAULT 1,
    requested_by  uuid,
    created_at    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msredeem_code_course
    ON public.microsoft_redeem_code(course_number);
CREATE INDEX IF NOT EXISTS idx_msredeem_code_created
    ON public.microsoft_redeem_code(created_at DESC);
