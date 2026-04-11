-- Migration: Auto Sanitise Data — retention window
-- Adds the configurable months window used by the auto_sanitise_data
-- weekly sweep. The sweep also reuses the existing
-- training_provider.auto_mask_sensitive_data column as the on/off flag.
--
-- Safe to run repeatedly.

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS sanitise_after_months INTEGER NOT NULL DEFAULT 6;

COMMENT ON COLUMN public.training_provider.sanitise_after_months IS
  'Retention window for the Auto Sanitise Data sweep. Rows older than this many months get NRIC + phone redacted in place. Default 6.';
