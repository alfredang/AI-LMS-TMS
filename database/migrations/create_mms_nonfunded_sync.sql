-- Phase 1 integration metadata only. No funded-course data is changed.
CREATE TABLE IF NOT EXISTS mms_sync_source (
  source_run_key text PRIMARY KEY,
  course_code text NOT NULL CHECK (upper(btrim(course_code)) NOT LIKE 'TGS%'),
  calendar_id text NOT NULL,
  event_ids jsonb NOT NULL DEFAULT '[]',
  tms_run_uuid uuid,
  masterlist_class_id uuid,
  operational_run_id text,
  trainer_approved_email text,
  person_aliases jsonb NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 0,
  snapshot_hash text,
  snapshot jsonb,
  target_result jsonb,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mms_sync_job (
  id bigserial PRIMARY KEY,
  source_run_key text NOT NULL REFERENCES mms_sync_source(source_run_key),
  trigger text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  dirty boolean NOT NULL DEFAULT false,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mms_sync_one_pending ON mms_sync_job(source_run_key) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS mms_sync_due ON mms_sync_job(state,available_at);
CREATE TABLE IF NOT EXISTS mms_sync_scan_log (
  id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), result jsonb NOT NULL
);

-- Outbox changes commit atomically with the operational edit. The worker rechecks
-- current course eligibility and rebuilds the snapshot after commit.
CREATE OR REPLACE FUNCTION mms_sync_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed jsonb;
BEGIN
  IF TG_OP='DELETE' THEN changed=to_jsonb(OLD); ELSE changed=to_jsonb(NEW); END IF;
  INSERT INTO mms_sync_job(source_run_key,trigger)
  SELECT s.source_run_key,TG_TABLE_NAME FROM mms_sync_source s
  WHERE upper(btrim(s.course_code)) NOT LIKE 'TGS%'
    AND NOT EXISTS (SELECT 1 FROM course_run cr JOIN course c ON c.id=cr.course_id
                    WHERE cr.id=s.tms_run_uuid AND upper(btrim(c.course_code)) LIKE 'TGS%')
    AND ((TG_TABLE_NAME='masterlist_table' AND changed->>'class_id'=s.masterlist_class_id::text)
      OR (TG_TABLE_NAME='course_run' AND changed->>'id'=s.tms_run_uuid::text)
      OR (TG_TABLE_NAME IN ('enrollment','course_session','course_run_trainer') AND changed->>'course_run_id'=s.tms_run_uuid::text)
      OR (TG_TABLE_NAME IN ('da_application','company_application') AND
          (lower(s.operational_run_id)=lower(changed->>'course_run_id') OR EXISTS (
          SELECT 1 FROM course_run cr WHERE cr.id=s.tms_run_uuid AND cr.course_run_id=changed->>'course_run_id')))
      OR (TG_TABLE_NAME IN ('app_user','trainer_profile','learner_profile','user_role_map') AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(s.snapshot->'learners','[]') || COALESCE(s.snapshot->'trainers','[]')) p
          WHERE p->>'source_id'=COALESCE(changed->>'user_id',changed->>'id'))))
  ON CONFLICT (source_run_key) WHERE state IN ('queued','running') DO UPDATE
    SET dirty=true,updated_at=now(),available_at=now();
  RETURN NULL;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['masterlist_table','course_run','enrollment','course_session','course_run_trainer','da_application','company_application','app_user','trainer_profile','learner_profile','user_role_map'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS mms_sync_change ON %I',t);
      EXECUTE format('CREATE TRIGGER mms_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mms_sync_source_changed()',t);
    END IF;
  END LOOP;
END;
$$;
