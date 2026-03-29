ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS master_list_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS tertiary_tms_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS tertiary_fms_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS tertiary_mms_url text;
ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS tertiary_tpms_url text;
