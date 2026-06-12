-- Add triggered_by column to wsq_sync_job so the UI can show whether a sync
-- was started manually by a user or automatically by the cron scheduler.
ALTER TABLE wsq_sync_job
  ADD COLUMN IF NOT EXISTS triggered_by TEXT NOT NULL DEFAULT 'user'
    CHECK (triggered_by IN ('user', 'cron'));
