-- Persist the QuickBooks DocNumber of the main Direct Application tax invoice.
--
-- Previously the pipeline re-fetched the DocNumber from QBO via qboReadInvoice
-- every time it needed it as PO# on the supplemental Grant/SFC invoices. Each
-- of those calls is a network hop that can fail transiently and abort the
-- whole pipeline. Storing the DocNumber alongside invoice_id eliminates the
-- lookup on re-runs and also lets the main-invoice idempotency check match an
-- orphan QBO invoice from a prior failed attempt.

ALTER TABLE public.da_application
  ADD COLUMN IF NOT EXISTS invoice_doc_number text;

COMMENT ON COLUMN public.da_application.invoice_doc_number IS
  'QuickBooks DocNumber of the main tax invoice (format TC{yy}-{mmdd}-{last6}). Cached to avoid qboReadInvoice on re-runs and used as PO# on supplemental Grant/SFC invoices.';
