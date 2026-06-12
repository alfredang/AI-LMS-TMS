-- Migration: configurable Direct Application invoice email CC/BCC recipients
-- Keeps recipient routing out of application code and environment-only config.

ALTER TABLE public.training_provider
  ADD COLUMN IF NOT EXISTS da_invoice_email_cc text,
  ADD COLUMN IF NOT EXISTS da_invoice_email_bcc text;

COMMENT ON COLUMN public.training_provider.da_invoice_email_cc IS
  'Comma, semicolon, or newline separated CC recipients for Direct Application main invoice emails. Overrides QBO_INVOICE_EMAIL_CC and QuickBooks SalesEmailCc when set.';

COMMENT ON COLUMN public.training_provider.da_invoice_email_bcc IS
  'Comma, semicolon, or newline separated BCC recipients for Direct Application main invoice emails. Overrides QBO_INVOICE_EMAIL_BCC and QuickBooks SalesEmailBcc when set.';
