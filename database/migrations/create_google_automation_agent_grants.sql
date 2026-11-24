-- TMS-managed agent access: token digests only, never the raw agent credential.
CREATE TABLE IF NOT EXISTS google_automation_agent_grant (
  connection_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_email TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  script_ids TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  PRIMARY KEY(connection_id,id)
);
