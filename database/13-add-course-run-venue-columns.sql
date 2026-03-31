-- Add venue, registration, and admin columns to course_run
-- These store SSG-sourced data locally so edits don't push back to SSG.
-- All nullable — no existing data is modified.

ALTER TABLE course_run
  ADD COLUMN IF NOT EXISTS registration_opening_date DATE,
  ADD COLUMN IF NOT EXISTS registration_closing_date DATE,
  ADD COLUMN IF NOT EXISTS venue_block TEXT,
  ADD COLUMN IF NOT EXISTS venue_street TEXT,
  ADD COLUMN IF NOT EXISTS venue_building TEXT,
  ADD COLUMN IF NOT EXISTS venue_floor TEXT,
  ADD COLUMN IF NOT EXISTS venue_unit TEXT,
  ADD COLUMN IF NOT EXISTS venue_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS venue_room TEXT,
  ADD COLUMN IF NOT EXISTS venue_wheelchair_access BOOLEAN,
  ADD COLUMN IF NOT EXISTS course_vacancy_code TEXT,
  ADD COLUMN IF NOT EXISTS course_vacancy_description TEXT,
  ADD COLUMN IF NOT EXISTS course_admin_email TEXT;
