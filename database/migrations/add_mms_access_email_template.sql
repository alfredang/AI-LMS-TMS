-- Editable Training Provider template for C-series MMS class-access emails.
ALTER TABLE training_provider
  ADD COLUMN IF NOT EXISTS mms_access_email_subject TEXT,
  ADD COLUMN IF NOT EXISTS mms_access_email_body TEXT;
