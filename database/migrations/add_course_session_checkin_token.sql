-- Take Attendance QR (E-Attendance page): each session gets a random check-in token; the QR
-- encodes /checkin/<token> and a check-in marks that session in course_attendance.
-- Runtime twin: ensureCheckinColumn() in lib/attendance/checkin.ts.
-- Idempotent.
ALTER TABLE course_session ADD COLUMN IF NOT EXISTS checkin_token text;
CREATE UNIQUE INDEX IF NOT EXISTS course_session_checkin_token_uidx
  ON course_session (checkin_token) WHERE checkin_token IS NOT NULL;
