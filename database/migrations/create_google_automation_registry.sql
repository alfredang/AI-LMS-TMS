-- Independent registry only: no scheduler changes or business-process triggers.
CREATE TABLE IF NOT EXISTS google_automation_project (
  connection_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Unclassified',
  schedule TEXT NOT NULL DEFAULT 'Not verified',
  dependencies TEXT NOT NULL DEFAULT '',
  refreshed_at TIMESTAMPTZ,
  source_hash TEXT,
  source_ciphertext TEXT,
  access_status TEXT NOT NULL DEFAULT 'Not checked',
  PRIMARY KEY (connection_id, script_id)
);
CREATE TABLE IF NOT EXISTS google_automation_draft (
  id UUID PRIMARY KEY,
  connection_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  source_ciphertext TEXT NOT NULL,
  changed_files JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  published_by TEXT,
  FOREIGN KEY (connection_id, script_id) REFERENCES google_automation_project(connection_id, script_id)
);
CREATE INDEX IF NOT EXISTS google_automation_draft_project_idx ON google_automation_draft(connection_id, script_id, created_at DESC);
