CREATE TABLE IF NOT EXISTS google_automation_connection (
 singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
 config_ciphertext TEXT NOT NULL,
 configured_by TEXT NOT NULL,
 configured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
