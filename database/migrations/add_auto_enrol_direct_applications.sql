-- Migration: Auto-Enrol Direct Applications to SSG + QB Invoice
-- Adds tracking columns to da_application and two toggles to training_provider.
-- Idempotent: safe to run multiple times.

-- 1. da_application tracking columns
ALTER TABLE public.da_application
    ADD COLUMN IF NOT EXISTS enrolment_id character varying(100),
    ADD COLUMN IF NOT EXISTS grant_id character varying(100),
    ADD COLUMN IF NOT EXISTS invoice_id character varying(100),
    ADD COLUMN IF NOT EXISTS qb_customer_ref character varying(50),
    ADD COLUMN IF NOT EXISTS auto_enrol_status character varying(50),
    ADD COLUMN IF NOT EXISTS auto_enrol_error text;

COMMENT ON COLUMN public.da_application.enrolment_id IS 'SSG enrolment reference number returned by /tpg/enrolments';
COMMENT ON COLUMN public.da_application.grant_id IS 'SSG grant identifier from grant search';
COMMENT ON COLUMN public.da_application.invoice_id IS 'QuickBooks invoice ID for the net-fee invoice';
COMMENT ON COLUMN public.da_application.qb_customer_ref IS 'Cached QuickBooks CustomerRef for the trainee (find-or-create)';
COMMENT ON COLUMN public.da_application.auto_enrol_status IS 'Auto-enrol pipeline status: pending | enroled | grant_found | invoiced | failed';
COMMENT ON COLUMN public.da_application.auto_enrol_error IS 'Last error from auto-enrol pipeline, format: "<step>: <reason>"';

CREATE INDEX IF NOT EXISTS idx_da_application_auto_enrol_status
    ON public.da_application(auto_enrol_status);

-- 2. training_provider toggles
ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS auto_enrol_direct_applications boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS auto_generate_qb_invoice boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.training_provider.auto_enrol_direct_applications IS 'Master toggle: auto-submit direct applications to SSG after Excel upload';
COMMENT ON COLUMN public.training_provider.auto_generate_qb_invoice IS 'Secondary toggle: auto-create QuickBooks invoice after successful SSG enrolment (requires auto_enrol_direct_applications = true)';
