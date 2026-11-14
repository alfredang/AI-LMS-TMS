-- AI Exam integration (Company Settings → Integrations → AI Exam): the Tertiary Exams
-- API base URL and bearer token used to register a class's learners on a practice exam.
-- Also created at first save by pages/api/training-provider/update.ts.
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS exams_api_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS exams_api_token text;
