// Each deployment has its own database. Keep settings scoped to the active provider row.
export const AI_PROVIDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS training_provider_ai (
  training_provider_id uuid PRIMARY KEY REFERENCES training_provider(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'claude' CHECK (provider IN ('claude', 'openai')),
  openai_model text NOT NULL DEFAULT 'gpt-5.6-sol',
  oauth_encrypted text,
  claude_encrypted text,
  verified_model text,
  claude_fallback boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
 );
ALTER TABLE training_provider_ai ADD COLUMN IF NOT EXISTS claude_fallback boolean NOT NULL DEFAULT false;`;
