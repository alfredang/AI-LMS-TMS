-- Add the Lab Simulator URL and Practice Exam URL to the course courseware links.
--
-- Both are optional links edited in the Developer course editor (placed after
-- Activities/Lab). When set, each is shown as a card in the Courseware section
-- of BOTH the Learner and Trainer class views; NULL = card hidden.
--   lab_simulator_url  - interactive, browser-based lab simulator (e.g. GitHub Pages)
--   practice_exam_url  - practice exam page for the course
-- (practice_exam_url is a plain link; it is unrelated to practice_exam_code,
-- which drives the Tertiary Exams learner-registration integration.)
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS lab_simulator_url text,
    ADD COLUMN IF NOT EXISTS practice_exam_url text;

COMMENT ON COLUMN public.course.lab_simulator_url IS
    'Lab Simulator URL — link to the course''s interactive lab simulator. Visible to Learner and Trainer roles when set.';
COMMENT ON COLUMN public.course.practice_exam_url IS
    'Practice Exam URL — link to the course''s practice exam. Visible to Learner and Trainer roles when set.';

COMMIT;
