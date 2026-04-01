-- Add assessment_summary_record_url column to course table
ALTER TABLE course ADD COLUMN IF NOT EXISTS assessment_summary_record_url text;
