-- TMS is the authority for whether a funded course may be advertised or sold.
-- These fields are refreshed from SSG's support period and published runs, then
-- pushed to the Magento storefront by the daily scheduler task.
ALTER TABLE course
  ADD COLUMN IF NOT EXISTS course_availability_status TEXT,
  ADD COLUMN IF NOT EXISTS course_availability_reason TEXT,
  ADD COLUMN IF NOT EXISTS course_availability_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ssg_has_future_run BOOLEAN;

CREATE INDEX IF NOT EXISTS course_availability_status_idx
  ON course (course_availability_status)
  WHERE course_code LIKE 'TGS-%';
