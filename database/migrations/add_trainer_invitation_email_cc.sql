-- Migration: Trainer invitation / accept / decline email CC lists
-- Adds three columns on training_provider for comma-separated CC lists
-- attached to the trainer invitation email, the accept confirmation
-- email, and the decline acknowledgement email. All three are honoured
-- by every send path (manual, auto-escalation on decline, weekly sweep,
-- respond.ts). NULL means "no CC".
--
-- Safe to run repeatedly.

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS trainer_invitation_email_cc TEXT,
    ADD COLUMN IF NOT EXISTS trainer_accept_email_cc TEXT,
    ADD COLUMN IF NOT EXISTS trainer_decline_email_cc TEXT;

COMMENT ON COLUMN public.training_provider.trainer_invitation_email_cc IS
  'Comma-separated CC list for trainer invitation emails.';
COMMENT ON COLUMN public.training_provider.trainer_accept_email_cc IS
  'Comma-separated CC list for trainer accept confirmation emails.';
COMMENT ON COLUMN public.training_provider.trainer_decline_email_cc IS
  'Comma-separated CC list for trainer decline acknowledgement emails.';
