-- Safe for all tenants: enabled only for the verified Tertiary provider.
ALTER TABLE public.training_provider
  ADD COLUMN IF NOT EXISTS course_validity_tpg_enabled boolean NOT NULL DEFAULT false;

UPDATE public.training_provider
SET course_validity_tpg_enabled = true
WHERE uen = '201200696W';
