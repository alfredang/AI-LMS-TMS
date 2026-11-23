-- Practice exam on exams.tertiaryinfotech.com linked to a course (e.g. TGS-2026061312 → CCAR-F).
-- Trainers register the class's learners for it from the E-Attendance page (Practice Exam panel).
-- Also created at first use by lib/practiceExam/examsApi.ts (ensurePracticeExamColumn).
ALTER TABLE course ADD COLUMN IF NOT EXISTS practice_exam_code text;
