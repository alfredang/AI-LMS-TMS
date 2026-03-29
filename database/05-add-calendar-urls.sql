-- Add calendar URL columns to training_provider table
-- These store the embeddable calendar URLs for Google Calendar and Microsoft Outlook
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS google_calendar_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS ms_calendar_url text;
