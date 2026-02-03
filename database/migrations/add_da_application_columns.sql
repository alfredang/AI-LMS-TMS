-- Migration: Add new columns to da_application table
-- Date: 2026-02-03
-- Description: Adding 9 new columns from SSG Excel export format

-- Add application_date column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS application_date DATE;

-- Add application_cancelled_by column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS application_cancelled_by CHARACTER VARYING(255);

-- Add full_course_fee column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS full_course_fee NUMERIC(10,2);

-- Add gst column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS gst NUMERIC(10,2);

-- Add skillsfuture_subsidy column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS skillsfuture_subsidy NUMERIC(10,2);

-- Add skillsfuture_credit column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS skillsfuture_credit NUMERIC(10,2);

-- Add skillsfuture_credit_claim_id column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS skillsfuture_credit_claim_id CHARACTER VARYING(100);

-- Add highest_qualification column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS highest_qualification CHARACTER VARYING(255);

-- Add highest_relevant_certification column
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS highest_relevant_certification CHARACTER VARYING(255);

-- Add comments for new columns
COMMENT ON COLUMN public.da_application.application_date IS 'Date when the application was submitted';
COMMENT ON COLUMN public.da_application.application_cancelled_by IS 'Entity or person who cancelled the application';
COMMENT ON COLUMN public.da_application.full_course_fee IS 'Full course fee before subsidies';
COMMENT ON COLUMN public.da_application.gst IS 'GST amount';
COMMENT ON COLUMN public.da_application.skillsfuture_subsidy IS 'SkillsFuture subsidy amount';
COMMENT ON COLUMN public.da_application.skillsfuture_credit IS 'SkillsFuture credit amount used';
COMMENT ON COLUMN public.da_application.skillsfuture_credit_claim_id IS 'SkillsFuture credit claim ID';
COMMENT ON COLUMN public.da_application.highest_qualification IS 'Trainee highest qualification';
COMMENT ON COLUMN public.da_application.highest_relevant_certification IS 'Trainee highest relevant certification';
