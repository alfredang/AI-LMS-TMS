CREATE TABLE IF NOT EXISTS google_automation_trigger_change (
 id UUID PRIMARY KEY, connection_id TEXT NOT NULL, script_id TEXT NOT NULL,
 trigger_key TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL,
 before JSONB NOT NULL, after JSONB NOT NULL, context JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 applied_at TIMESTAMPTZ, applied_by TEXT,
 FOREIGN KEY(connection_id,script_id) REFERENCES google_automation_project(connection_id,script_id)
);
ALTER TABLE google_automation_trigger_change ADD COLUMN IF NOT EXISTS applied_by TEXT;
CREATE INDEX IF NOT EXISTS google_automation_trigger_change_project_idx
 ON google_automation_trigger_change(connection_id,script_id,created_at DESC);
