-- Tertiary Infotech Academy tenant seed.
--
-- Tenant-specific data that used to live inside the generic migrations:
--   * SSG app count / names backfill (legacy 4-app layout)
--   * Payroll role grants for Tertiary staff
--
-- Idempotent. Only apply this on a Tertiary deployment.

BEGIN;

-- 1. SSG: restore the legacy 4-app layout and historical names.
--    Only touches rows that still look untouched (count=1, names empty),
--    so re-running on a configured tenant is a no-op.
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

-- 2. Grant Payroll role to Tertiary staff (no-op if user doesn't exist yet,
--    or if the role is already assigned).
INSERT INTO public.user_role_map (user_id, role)
SELECT id, 'Payroll'::public.user_role
  FROM public.app_user
 WHERE email IN ('tansc@tertiaryinfotech.com', 'angch@tertiaryinfotech.com')
ON CONFLICT (user_id, role) DO NOTHING;

COMMIT;
