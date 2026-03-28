ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS email_user text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS google_client_id text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS google_client_secret text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS google_refresh_token text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS google_slides_template_id text;
