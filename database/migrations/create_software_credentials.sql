-- Software credentials registry for shared third-party logins (AWS Skill Builder,
-- Skillable, Microsoft 365, etc.) used by training staff. Admin-only.
--
-- Tenant-specific rows live in database/seeds/<tenant>-seed.sql. This migration
-- only creates the table; it does not seed any credentials.
--
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS public.software_credential (
    id              BIGSERIAL PRIMARY KEY,
    license         TEXT        NOT NULL,
    software        TEXT        NOT NULL DEFAULT '',
    login           TEXT        NOT NULL DEFAULT '',
    password        TEXT        NOT NULL DEFAULT '',
    licence_type    TEXT        NOT NULL DEFAULT '',
    url             TEXT        NOT NULL DEFAULT '',
    notes           TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_software_credential_license
    ON public.software_credential (license);

COMMIT;
