-- Server-side sessions backing real (non-forgeable) auth tokens.
-- The client holds an opaque random token; only its SHA-256 hex hash is stored.
-- Idempotent: safe to run repeatedly (also applied by lib/db.ts auto-migrations).

CREATE TABLE IF NOT EXISTS user_session (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session (user_id);
CREATE INDEX IF NOT EXISTS user_session_expires_idx ON user_session (expires_at);
