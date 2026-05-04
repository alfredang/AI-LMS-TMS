-- Add per-provider configurable SSG app count and app names.
-- Default for brand-new providers is 1 app and an empty name map; tenants
-- configure their own labels via the Training Provider profile UI.
--
-- Tenant-specific backfills (e.g. Tertiary's legacy 4-app layout) live in
-- database/seeds/<tenant>-seed.sql, not in this generic migration.
--
-- Safe to run repeatedly.

BEGIN;

-- 1. Create the columns with the canonical types if they're missing.
--    No-op when they already exist (regardless of their current type).
ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS ssg_app_count smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ssg_app_names jsonb    NOT NULL DEFAULT '{}'::jsonb;

-- 2. Heal databases where these columns were created with the wrong type
--    (e.g. an earlier hand-crafted patch added them as INTEGER / TEXT).
--    Each branch only fires when the live type does NOT match the canonical
--    type, so DBs that are already correct are untouched. Casts use COALESCE
--    so existing data is preserved; only NULLs fall back to the default.
DO $$
DECLARE
    v_count_type text;
    v_names_type text;
BEGIN
    SELECT data_type
      INTO v_count_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'training_provider'
       AND column_name  = 'ssg_app_count';

    SELECT data_type
      INTO v_names_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'training_provider'
       AND column_name  = 'ssg_app_names';

    IF v_count_type IS NOT NULL AND v_count_type <> 'smallint' THEN
        EXECUTE 'ALTER TABLE public.training_provider
                    ALTER COLUMN ssg_app_count DROP NOT NULL';
        EXECUTE 'UPDATE public.training_provider
                    SET ssg_app_count = 1
                  WHERE ssg_app_count IS NULL';
        EXECUTE 'ALTER TABLE public.training_provider
                    ALTER COLUMN ssg_app_count
                          TYPE smallint
                          USING ssg_app_count::smallint,
                    ALTER COLUMN ssg_app_count SET DEFAULT 1,
                    ALTER COLUMN ssg_app_count SET NOT NULL';
    END IF;

    IF v_names_type IS NOT NULL AND v_names_type <> 'jsonb' THEN
        EXECUTE 'ALTER TABLE public.training_provider
                    ALTER COLUMN ssg_app_names DROP NOT NULL';
        EXECUTE 'UPDATE public.training_provider
                    SET ssg_app_names = NULL
                  WHERE ssg_app_names = ''''';
        EXECUTE 'UPDATE public.training_provider
                    SET ssg_app_names = ''{}''
                  WHERE ssg_app_names IS NULL';
        EXECUTE 'ALTER TABLE public.training_provider
                    ALTER COLUMN ssg_app_names
                          TYPE jsonb
                          USING ssg_app_names::jsonb,
                    ALTER COLUMN ssg_app_names SET DEFAULT ''{}''::jsonb,
                    ALTER COLUMN ssg_app_names SET NOT NULL';
    END IF;
END$$;

COMMIT;
