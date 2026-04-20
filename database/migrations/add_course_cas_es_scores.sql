-- Add CAS (Completion Accuracy Score) and ES (Enrolment Score) columns to course table
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS cas_score numeric(6,2);
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS es_score numeric(6,2);
