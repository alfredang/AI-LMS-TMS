-- Cache the WSQ course support period (taggingCode "1000") fetched from SSG
-- so the sync page can warn when a run's start date falls outside the window.
ALTER TABLE course
  ADD COLUMN IF NOT EXISTS ssg_wsq_support_from        DATE,
  ADD COLUMN IF NOT EXISTS ssg_wsq_support_to          DATE,
  ADD COLUMN IF NOT EXISTS ssg_wsq_support_refreshed_at TIMESTAMPTZ;
