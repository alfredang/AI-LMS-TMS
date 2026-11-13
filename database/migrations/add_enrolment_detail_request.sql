-- Enrolment-details requests: a learner with no SSG/TPGateway enrolment scans the class's
-- enrolment QR code (E-Attendance page) and submits their details on the public /enrol/[runId]
-- page; admins and the class's trainers then enrol them on TPGateway. Keyed by class + NRIC;
-- linked to a local enrolment only when staff act on it.
-- Runtime twin: ensureEnrolmentDetailRequestTable() in lib/learner/enrolmentDetailRequest.ts.
-- Idempotent.
CREATE TABLE IF NOT EXISTS enrolment_detail_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_uuid UUID,
  user_id UUID,
  course_run_uuid UUID NOT NULL,
  trainee_name TEXT NOT NULL,
  nric TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  email TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  sponsorship_type TEXT NOT NULL CHECK (sponsorship_type IN ('Individual', 'Employer')),
  employer_name TEXT,
  employer_uen TEXT,
  employer_contact_name TEXT,
  employer_contact_email TEXT,
  employer_contact_number TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'enrolled', 'failed', 'dismissed')),
  enrolment_ref TEXT,
  last_error TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  UNIQUE (course_run_uuid, nric)
);
CREATE INDEX IF NOT EXISTS enrolment_detail_request_run_idx ON enrolment_detail_request (course_run_uuid, status);
