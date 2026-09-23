-- Additive only. Do not backfill old messages with guessed event/session identities.
-- ensureTrainerWhatsappTable applies these same statements for existing installations.
BEGIN;
ALTER TABLE trainer_whatsapp_notification
  ADD COLUMN IF NOT EXISTS session_date DATE,
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS trainer_user_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_reminder_session_trainer
  ON trainer_whatsapp_notification(course_run_id, session_date, trainer_user_id)
  WHERE kind='class_reminder' AND session_date IS NOT NULL AND trainer_user_id IS NOT NULL;
COMMIT;
