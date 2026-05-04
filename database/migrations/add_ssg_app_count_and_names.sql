-- Add per-provider configurable SSG app count and app names.
-- Default for brand-new providers is 1 app. Existing rows are backfilled to 4
-- with the prior hard-coded names so visible behaviour does not change.

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS ssg_app_count smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS ssg_app_names jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: existing tenants keep the legacy 4-app layout and names.
UPDATE public.training_provider
SET ssg_app_count = 4,
    ssg_app_names = jsonb_build_object(
        'app1', 'SKILLETO TERTIARY',
        'app2', 'Training Management System',
        'app3', 'TIPL Tertiary Infotech Academy',
        'app4', 'TMS API'
    )
WHERE ssg_app_count = 1
  AND (ssg_app_names = '{}'::jsonb OR ssg_app_names IS NULL);
