-- Add force_first_password_change column to training_provider table
-- This setting controls whether users with default password must change it on first login
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS force_first_password_change boolean DEFAULT false NOT NULL;

-- Add default_password column to training_provider table
-- Allows training provider to set a custom default password for new accounts
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS default_password text;
