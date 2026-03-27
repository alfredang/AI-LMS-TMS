-- Add assessment_methods JSONB column to course table
-- Stores enabled assessment methods and their links as JSON
-- Example: {"writtenAssessment": {"enabled": true, "link": "https://..."}, "practicalExam": {"enabled": false, "link": ""}}
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS assessment_methods jsonb;

-- Add published_assessment_methods JSONB column to course_run table
-- Tracks which assessment methods are published per course run
-- Example: {"writtenAssessment": true, "practicalExam": false}
ALTER TABLE public.course_run ADD COLUMN IF NOT EXISTS published_assessment_methods jsonb DEFAULT '{}'::jsonb;
