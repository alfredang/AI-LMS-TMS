import pool from '../db';
let ready:Promise<unknown>|undefined;
export function ensureAndroidSchema(){return ready ||= pool.query(`
CREATE TABLE IF NOT EXISTS android_otp_limit (key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS android_push_device (
 token text PRIMARY KEY,user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 session_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS android_push_delivery (
 token text NOT NULL REFERENCES android_push_device(token) ON DELETE CASCADE,
 session_id uuid NOT NULL,starts_at timestamptz NOT NULL,days integer NOT NULL CHECK(days IN(1,3)),
 status text NOT NULL DEFAULT 'pending',lease_at timestamptz, sent_at timestamptz,
 PRIMARY KEY(token,session_id,starts_at,days));
`).catch(e=>{ready=undefined;throw e;});}
