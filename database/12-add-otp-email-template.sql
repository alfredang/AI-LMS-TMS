-- Add OTP email template columns to training_provider table
-- These store the customisable OTP email subject and body

ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS otp_email_subject TEXT;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS otp_email_body TEXT;
