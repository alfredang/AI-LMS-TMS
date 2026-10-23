-- Private server-side connection settings. A row is inserted only during pilot setup.
CREATE TABLE IF NOT EXISTS mms_handover_config (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  automatic boolean NOT NULL DEFAULT true,
  notifications_enabled boolean NOT NULL DEFAULT false,
  url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  course_allowlist text NOT NULL DEFAULT '',
  pilot_start_date date NOT NULL DEFAULT DATE '2026-10-23',
  public_origin text NOT NULL DEFAULT '',
  feedback_url_template text NOT NULL DEFAULT '',
  provider_id text NOT NULL DEFAULT 'tertiary-sg',
  website_id integer NOT NULL DEFAULT 1,
  horizon_days integer NOT NULL DEFAULT 60,
  access_support text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);
REVOKE ALL ON mms_handover_config FROM PUBLIC;
