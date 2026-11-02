-- Integration metadata only; registrations remain in the existing Master List.
ALTER TABLE masterlist_table ADD COLUMN IF NOT EXISTS course_code text;
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS masterlist_class_ids jsonb NOT NULL DEFAULT '[]';
UPDATE mms_sync_source SET masterlist_class_ids=jsonb_build_array(masterlist_class_id::text)
 WHERE masterlist_class_id IS NOT NULL AND masterlist_class_ids='[]'::jsonb;
