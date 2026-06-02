-- WSQ Schedule Sync job table.
-- Stores progress and results for each Sync-to-SSG run so that all users
-- on the WSQ Schedule Sync page see the same live state, and results persist
-- across page navigation.

CREATE TABLE IF NOT EXISTS wsq_sync_job (
  id            SERIAL PRIMARY KEY,
  status        TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  total_items   INT         NOT NULL DEFAULT 0,
  items_done    INT         NOT NULL DEFAULT 0,
  submitted     INT         NOT NULL DEFAULT 0,
  already_exists INT        NOT NULL DEFAULT 0,
  ssg_errors    INT         NOT NULL DEFAULT 0,
  skipped       INT         NOT NULL DEFAULT 0,
  failures      JSONB       NOT NULL DEFAULT '[]',
  summary       TEXT
);

-- Only the most recent job ever needs to be queried quickly.
CREATE INDEX IF NOT EXISTS wsq_sync_job_started_at_idx ON wsq_sync_job (started_at DESC);
