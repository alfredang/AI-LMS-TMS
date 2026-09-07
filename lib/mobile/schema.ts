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
    user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE, requested_at timestamptz NOT NULL DEFAULT now());`)
    .catch(e => {ready=undefined; throw e;});
}
