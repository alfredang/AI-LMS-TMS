-- Durable mapping: course_run (per session date) -> Google Calendar event.
-- Replaces the fuzzy-match-only model so dedup/cleanup is exact and race-safe.
-- A multi-day class has one row per session date (events are per-day instances).

CREATE TABLE IF NOT EXISTS course_run_calendar_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_run_id   uuid NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
  event_date      date NOT NULL,
  google_event_id text NOT NULL,           -- the per-instance / standalone event id
  base_event_id   text,                     -- recurring series base id (null for standalone)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One event per class per day = the duplicate guard.
  UNIQUE (course_run_id, event_date)
);

-- Stop two rows ever claiming the same Google event.
CREATE UNIQUE INDEX IF NOT EXISTS crce_google_event_uniq
  ON course_run_calendar_event (google_event_id);

CREATE INDEX IF NOT EXISTS crce_course_run_idx
  ON course_run_calendar_event (course_run_id);
