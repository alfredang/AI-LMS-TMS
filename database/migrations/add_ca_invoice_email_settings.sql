-- Migration: Company Application auto-send invoice email + CC/BCC recipients
-- Mirrors the Direct Application settings (auto_send_invoice_email,
-- da_invoice_email_cc, da_invoice_email_bcc) but for the CA pipeline. The CA
-- recipient is the EMPLOYER contact email, not the learner.

ALTER TABLE public.training_provider
  ADD COLUMN IF NOT EXISTS ca_auto_send_invoice_email boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ca_invoice_email_cc text,
  ADD COLUMN IF NOT EXISTS ca_invoice_email_bcc text;

COMMENT ON COLUMN public.training_provider.ca_auto_send_invoice_email IS
  'Master toggle for emailing the main tax invoice to the EMPLOYER after Company Application invoice generation. Defaults to false for safe testing.';

COMMENT ON COLUMN public.training_provider.ca_invoice_email_cc IS
  'Comma, semicolon, or newline separated CC recipients for Company Application main invoice emails. Overrides QuickBooks SalesEmailCc when set.';

COMMENT ON COLUMN public.training_provider.ca_invoice_email_bcc IS
  'Comma, semicolon, or newline separated BCC recipients for Company Application main invoice emails. Overrides QuickBooks SalesEmailBcc when set.';
