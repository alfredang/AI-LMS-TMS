-- Migration: Change enrolment_grant_status from boolean to enrolment_status (TEXT)
-- This allows storing "Confirmed", "Cancelled", or "Not Found" status from the search enrolment API

-- Step 1: Add a new text column called enrolment_status
ALTER TABLE public.da_application
ADD COLUMN IF NOT EXISTS enrolment_status TEXT;

-- Step 2: Migrate existing boolean values to text
UPDATE public.da_application
SET enrolment_status = CASE
    WHEN enrolment_grant_status = true THEN 'Confirmed'
    WHEN enrolment_grant_status = false THEN 'Cancelled'
    ELSE NULL
END;

-- Step 3: Drop the old boolean column
ALTER TABLE public.da_application
DROP COLUMN IF EXISTS enrolment_grant_status;

-- Comment on the new column
COMMENT ON COLUMN public.da_application.enrolment_status IS 'Enrolment status from SSG API: Confirmed, Cancelled, or Not Found';
