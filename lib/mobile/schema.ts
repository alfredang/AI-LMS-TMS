import pool from '../db';
let ready: Promise<unknown> | undefined;
export function ensureMobileSchema() {
  return ready ||= pool.query(`CREATE TABLE IF NOT EXISTS mobile_push_device (
    token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    environment text NOT NULL CHECK(environment IN ('production','sandbox')),
    enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS mobile_push_delivery (
    token text NOT NULL REFERENCES mobile_push_device(token) ON DELETE CASCADE,
    session_id uuid NOT NULL, starts_at timestamptz NOT NULL, days integer NOT NULL CHECK(days IN(1,3)),
    sent_at timestamptz, PRIMARY KEY(token,session_id,starts_at,days));
    CREATE TABLE IF NOT EXISTS mobile_deletion_request (
    user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE, requested_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS theme_preference text;
    -- Trainer credentials shown as badges in the apps (ACLP stays trainer_profile.trainer_type).
    ALTER TABLE trainer_profile ADD COLUMN IF NOT EXISTS dddpl boolean NOT NULL DEFAULT false;
    ALTER TABLE trainer_profile ADD COLUMN IF NOT EXISTS taepp boolean NOT NULL DEFAULT false;
    -- The apps' Support page: {email, phone, whatsapp, feedbackTo, feedbackCc}, per tenant.
    ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS app_support jsonb;
    CREATE TABLE IF NOT EXISTS mobile_support_message (
    id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    subject text NOT NULL, message text NOT NULL, sent boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now());`)
    .catch(e => {ready=undefined; throw e;});
}
