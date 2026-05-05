-- Add per-provider configurable Virtual Meeting platform.
-- Lets each Training Provider pick the default conferencing tool surfaced
-- in the Learner / Trainer "My Classes" detail view (Google Meet, Zoom,
-- Microsoft Teams). Allowed values are validated app-side (not via CHECK)
-- so new providers can be added without a migration.
--
-- NULL / missing → treated as 'google_meet' everywhere downstream, so
-- existing tenants render exactly as before until they opt-in.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS virtual_meeting_provider text DEFAULT 'google_meet'::text;

COMMIT;
