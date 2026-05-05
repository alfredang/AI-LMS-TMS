-- Migration: Case-insensitive email on app_user
--
-- Why: case-variants of the same email (e.g. "Foo@bar.com" vs "foo@bar.com")
-- were creating duplicate user accounts. The old UNIQUE(email) constraint was
-- case-sensitive, so both could coexist with split enrollments/attendance/roles.
--
-- This migration:
--   1. Lowercases all existing email and secondary_email values.
--   2. Replaces the case-sensitive UNIQUE(email) with a UNIQUE INDEX on LOWER(email).
--   3. Installs a BEFORE INSERT/UPDATE trigger that lowercases email and
--      secondary_email automatically — so every write path (22 insert sites
--      across the codebase) is protected without needing per-site changes.
--
-- One-time merge of existing case-variant duplicates is NOT in this migration:
-- it requires per-pair survivor decisions (which row keeps enrollments, etc.)
-- and is a data-migration script, not a schema migration. See
-- scratch/dup_merge.js for the script that performed the prod merge on
-- 2026-05-05. New deployments start clean, so they don't need it.
--
-- Safe to run repeatedly.

BEGIN;

-- 1. Backfill: lowercase any existing mixed-case emails.
--    On a fresh deploy this is a no-op. On an existing deploy with mixed-case
--    duplicates this will FAIL the unique-index step below — see header note;
--    run the dedup script first.
UPDATE public.app_user
SET email = LOWER(email)
WHERE email <> LOWER(email);

UPDATE public.app_user
SET secondary_email = LOWER(secondary_email)
WHERE secondary_email IS NOT NULL AND secondary_email <> LOWER(secondary_email);

-- 2. Drop the old case-sensitive UNIQUE(email) constraint if present.
ALTER TABLE public.app_user DROP CONSTRAINT IF EXISTS app_user_email_key;

-- 3. Add the case-insensitive unique index.
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_key
  ON public.app_user (LOWER(email));

-- 4. Trigger function: force lowercase on email + secondary_email.
CREATE OR REPLACE FUNCTION public.app_user_lowercase_email()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := LOWER(NEW.email);
  END IF;
  IF NEW.secondary_email IS NOT NULL THEN
    NEW.secondary_email := LOWER(NEW.secondary_email);
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Bind trigger to BEFORE INSERT and BEFORE UPDATE OF email, secondary_email.
DROP TRIGGER IF EXISTS app_user_lowercase_email_trg ON public.app_user;
CREATE TRIGGER app_user_lowercase_email_trg
  BEFORE INSERT OR UPDATE OF email, secondary_email
  ON public.app_user
  FOR EACH ROW
  EXECUTE FUNCTION public.app_user_lowercase_email();

COMMIT;
