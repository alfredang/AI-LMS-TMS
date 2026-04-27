-- Toggle that controls whether the Direct Application invoice pipeline
-- emails the main tax invoice to the learner.
--
-- Defaults to FALSE so the pipeline can be tested safely without
-- accidentally emailing learners. Flip to TRUE from the toggle in
-- Admin -> Personal -> Direct Application (Upload or View tab) once
-- invoices have been verified to generate correctly.
--
-- Behavior:
--   * FALSE -> invoices are still created, PDFs still uploaded to Drive,
--              billing history still synced -- only the email step is skipped
--   * TRUE  -> main tax invoice is emailed to the learner via QuickBooks
--              (Grant + SFC supplemental invoices are never emailed regardless)

ALTER TABLE public.training_provider
  ADD COLUMN IF NOT EXISTS auto_send_invoice_email boolean DEFAULT false;

COMMENT ON COLUMN public.training_provider.auto_send_invoice_email IS
  'Master toggle for emailing the main tax invoice to learners after Direct Application invoice generation. Defaults to false for safe testing.';
