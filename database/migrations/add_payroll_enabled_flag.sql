-- Migration: Payroll role enable/disable flag
-- Adds a per-tenant boolean controlling whether the Payroll role is exposed.
-- Default is FALSE (disabled) so the role is opt-in for each TP instance.
-- Safe to run repeatedly.

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS payroll_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.training_provider.payroll_enabled IS
  'When TRUE, the Payroll role appears in role pickers and the /api/payroll/* endpoints are usable. Default FALSE.';
