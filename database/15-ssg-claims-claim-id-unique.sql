-- Ensure claim_id is unique for dedupe + race-safe upserts.
-- Safe to run multiple times.

DO $$
BEGIN
  -- Prefer a UNIQUE CONSTRAINT (explicit schema intent).
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t ON t.oid = c.conrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    WHERE  n.nspname = 'public'
      AND  t.relname = 'ssg_claims'
      AND  c.contype = 'u'
      AND  c.conname = 'ssg_claims_claim_id_key'
  ) THEN
    ALTER TABLE public.ssg_claims
      ADD CONSTRAINT ssg_claims_claim_id_key UNIQUE (claim_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- already exists
    NULL;
END $$;

-- Also ensure there is a usable unique index for ON CONFLICT performance.
-- If the constraint exists, Postgres already created an index; IF NOT EXISTS keeps this safe.
CREATE UNIQUE INDEX IF NOT EXISTS ssg_claims_claim_id_unique_idx
  ON public.ssg_claims (claim_id);

