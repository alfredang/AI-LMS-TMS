-- SWDA Enrolment form (public /enrol/[runId]) now asks for the learner's nationality.
-- Runtime twin: ensureEnrolmentDetailRequestTable() in lib/learner/enrolmentDetailRequest.ts.
-- Idempotent.
ALTER TABLE enrolment_detail_request ADD COLUMN IF NOT EXISTS nationality TEXT;
