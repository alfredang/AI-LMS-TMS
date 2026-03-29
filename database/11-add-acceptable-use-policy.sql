-- Add acceptable_use_policy column to training_provider table
-- This stores the editable acceptable use policy content displayed on the login page

ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS acceptable_use_policy TEXT;
