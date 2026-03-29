-- Add privacy_policy column to training_provider table
-- This stores the editable privacy policy content displayed on the login page

ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS privacy_policy TEXT;
