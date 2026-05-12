-- Adds the MySkillsFuture Direct Application email-ingest toggle and audit log.

ALTER TABLE public.training_provider
  ADD COLUMN IF NOT EXISTS auto_import_da_from_email boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.training_provider.auto_import_da_from_email IS
  'Master toggle for importing Direct Application confirmation emails from MySkillsFuture via Google Apps Script. Defaults to false for safe rollout.';

COMMENT ON COLUMN public.da_application.auto_enrol_status IS
  'Auto-enrol pipeline status: pending | pending_identity | enroled | grant_found | invoiced | failed';

CREATE TABLE IF NOT EXISTS public.direct_application_email_ingest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text,
  source_message_id text,
  source_thread_id text,
  subject text,
  status text NOT NULL,
  identity_status text,
  auto_enrol_status text,
  error_message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_da_email_ingest_log_application_id
  ON public.direct_application_email_ingest_log(application_id);

CREATE INDEX IF NOT EXISTS idx_da_email_ingest_log_source_message_id
  ON public.direct_application_email_ingest_log(source_message_id);
