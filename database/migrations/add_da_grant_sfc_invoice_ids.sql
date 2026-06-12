-- Direct Application multi-invoice support.
--
-- Adds columns for the two supplemental QuickBooks invoices that are now
-- created alongside the main tax invoice:
--   * Grant invoice   — DocNumber = SSG grant reference (GRN-xxxx-xxxxxx)
--   * SFC invoice     — DocNumber = SSG SkillsFuture claim ID (SFC-CA-xxxx-xxxxxx)
--
-- Each supplemental invoice gets its own QB invoice id plus its own Google
-- Drive file id / web view link so the admin UI and billing history can link
-- to the real PDF. The drive_file_id / drive_web_view_link columns for the
-- main invoice are also declared here defensively — earlier branches were
-- relying on an ad-hoc ALTER at runtime.

ALTER TABLE public.da_application
  ADD COLUMN IF NOT EXISTS invoice_drive_file_id text,
  ADD COLUMN IF NOT EXISTS invoice_drive_web_view_link text,
  ADD COLUMN IF NOT EXISTS grant_invoice_id character varying(100),
  ADD COLUMN IF NOT EXISTS grant_invoice_drive_file_id text,
  ADD COLUMN IF NOT EXISTS grant_invoice_drive_web_view_link text,
  ADD COLUMN IF NOT EXISTS sfc_invoice_id character varying(100),
  ADD COLUMN IF NOT EXISTS sfc_invoice_drive_file_id text,
  ADD COLUMN IF NOT EXISTS sfc_invoice_drive_web_view_link text;

COMMENT ON COLUMN public.da_application.invoice_drive_file_id IS 'Google Drive file id for the main tax invoice PDF';
COMMENT ON COLUMN public.da_application.invoice_drive_web_view_link IS 'Google Drive web view link for the main tax invoice PDF';
COMMENT ON COLUMN public.da_application.grant_invoice_id IS 'QuickBooks invoice id for the supplemental Grant invoice (positive amounts, DocNumber = SSG grant_id)';
COMMENT ON COLUMN public.da_application.grant_invoice_drive_file_id IS 'Google Drive file id for the Grant invoice PDF';
COMMENT ON COLUMN public.da_application.grant_invoice_drive_web_view_link IS 'Google Drive web view link for the Grant invoice PDF';
COMMENT ON COLUMN public.da_application.sfc_invoice_id IS 'QuickBooks invoice id for the supplemental SkillsFuture Credit invoice (positive amount, DocNumber = ssg_claims.claim_id)';
COMMENT ON COLUMN public.da_application.sfc_invoice_drive_file_id IS 'Google Drive file id for the SFC invoice PDF';
COMMENT ON COLUMN public.da_application.sfc_invoice_drive_web_view_link IS 'Google Drive web view link for the SFC invoice PDF';
