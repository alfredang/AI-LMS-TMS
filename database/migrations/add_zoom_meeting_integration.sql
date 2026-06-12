-- Add Zoom OAuth credentials and provider-neutral virtual meeting metadata.
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS zoom_oauth_client_id text,
    ADD COLUMN IF NOT EXISTS zoom_oauth_client_secret text,
    ADD COLUMN IF NOT EXISTS zoom_oauth_refresh_token text,
    ADD COLUMN IF NOT EXISTS zoom_oauth_access_token text,
    ADD COLUMN IF NOT EXISTS zoom_oauth_token_expires_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS zoom_account_id text,
    ADD COLUMN IF NOT EXISTS zoom_user_id text,
    ADD COLUMN IF NOT EXISTS zoom_user_email text,
    ADD COLUMN IF NOT EXISTS zoom_connected_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS zoom_enabled boolean DEFAULT false NOT NULL;

ALTER TABLE public.course_run
    ADD COLUMN IF NOT EXISTS virtual_meeting_provider text,
    ADD COLUMN IF NOT EXISTS virtual_meeting_external_id text,
    ADD COLUMN IF NOT EXISTS virtual_meeting_host_link text,
    ADD COLUMN IF NOT EXISTS virtual_meeting_password text,
    ADD COLUMN IF NOT EXISTS virtual_meeting_status text,
    ADD COLUMN IF NOT EXISTS virtual_meeting_synced_at timestamp with time zone;

UPDATE public.course_run
SET virtual_meeting_provider = 'google_meet'
WHERE virtual_meeting_provider IS NULL
  AND virtual_meeting_link IS NOT NULL;

COMMIT;
