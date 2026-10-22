-- Integration-only metadata; existing funded-course templates/settings are untouched.
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS first_session_at timestamptz;
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS handover_at timestamptz;
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS delivery_platform text NOT NULL DEFAULT 'mms';
ALTER TABLE mms_sync_source ADD COLUMN IF NOT EXISTS access_calendar_error text;
CREATE TABLE IF NOT EXISTS mms_access_notification (
  id bigserial PRIMARY KEY,
  source_run_key text NOT NULL REFERENCES mms_sync_source(source_run_key),
  person_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('learner','trainer')),
  email text NOT NULL,
  kind text NOT NULL DEFAULT 'initial',
  generation text NOT NULL DEFAULT 'initial',
  actor text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','review','cancelled')),
  revision bigint NOT NULL,
  template_version text NOT NULL DEFAULT 'mms-access-v1',
  destination text NOT NULL,
  rendered jsonb,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  sent_at timestamptz,
  message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_run_key,person_id,role,kind,generation)
);
CREATE INDEX IF NOT EXISTS mms_access_due ON mms_access_notification(state,available_at);
