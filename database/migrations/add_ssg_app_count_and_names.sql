-- Add per-provider configurable SSG app count and app names.
-- Default for brand-new providers is 1 app and an empty name map; tenants
-- configure their own labels via the Training Provider profile UI.
--
-- Tenant-specific backfills (e.g. Tertiary's legacy 4-app layout) live in
-- database/seeds/<tenant>-seed.sql, not in this generic migration.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS ssg_app_count smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ssg_app_names jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
