-- Durable history for scheduled direct-application retrieval/enrolment.
CREATE TABLE IF NOT EXISTS da_automation_run (
  id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed', 'interrupted')),
  fetched INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  attempted INTEGER NOT NULL DEFAULT 0,
  enrolled INTEGER NOT NULL DEFAULT 0,
  already_enrolled INTEGER NOT NULL DEFAULT 0,
  deferred INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS da_automation_run_started_idx ON da_automation_run (started_at DESC);
