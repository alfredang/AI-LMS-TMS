-- Source observations only; this never changes Google code or business schedules.
ALTER TABLE google_automation_project ADD COLUMN IF NOT EXISTS last_source_attempt_at TIMESTAMPTZ;
ALTER TABLE google_automation_project ADD COLUMN IF NOT EXISTS last_source_error TEXT;
CREATE TABLE IF NOT EXISTS google_automation_source_revision (
  id UUID PRIMARY KEY,
  connection_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_ciphertext TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, script_id) REFERENCES google_automation_project(connection_id, script_id)
);
CREATE INDEX IF NOT EXISTS google_automation_source_revision_project_idx
  ON google_automation_source_revision(connection_id, script_id, captured_at DESC, id DESC);
-- Preserve the existing last-known snapshot before its next refresh.
INSERT INTO google_automation_source_revision(id,connection_id,script_id,source_hash,source_ciphertext,captured_at)
SELECT gen_random_uuid(),p.connection_id,p.script_id,p.source_hash,p.source_ciphertext,COALESCE(p.refreshed_at,now())
FROM google_automation_project p
WHERE p.source_ciphertext IS NOT NULL AND p.source_hash IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM google_automation_source_revision r
    WHERE r.connection_id=p.connection_id AND r.script_id=p.script_id);
