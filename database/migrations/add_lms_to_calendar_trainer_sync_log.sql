-- Monitoring log for the daily "Add Trainers to Google Calendar" job (LMS -> Calendar).
-- One row per run. (Also created defensively at runtime via ensureLogTable().)

CREATE TABLE IF NOT EXISTS lms_to_calendar_trainer_sync_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at           timestamptz NOT NULL DEFAULT now(),
  window_start     date,
  window_end       date,
  runs_processed   integer DEFAULT 0,   -- classes with an LMS-assigned trainer in the window
  assignments      integer DEFAULT 0,   -- trainer-on-class assignments processed
  pushed           integer DEFAULT 0,   -- trainer attendees newly added to a calendar event
  already_present  integer DEFAULT 0,   -- trainer already on the event
  event_not_found  integer DEFAULT 0,   -- no matching calendar event for that class
  errors           integer DEFAULT 0,
  attention        jsonb,               -- event-not-found / error details
  ok               boolean NOT NULL DEFAULT true,
  error            text,
  duration_ms      integer
);

CREATE INDEX IF NOT EXISTS idx_lms_to_calendar_trainer_sync_log_run_at
  ON lms_to_calendar_trainer_sync_log (run_at DESC);
