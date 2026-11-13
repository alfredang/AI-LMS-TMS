-- Account-recovery details for shared software logins: the 2FA recovery code
-- issued by the vendor (e.g. Microsoft account "Your new code is …") and a
-- free-text note on how two-step verification is set up (authenticator app,
-- phone number, backup email).
--
-- The API also adds these columns lazily (pages/api/admin/software-credentials.ts),
-- so running this by hand is optional. Safe to run repeatedly.

BEGIN;

ALTER TABLE public.software_credential
    ADD COLUMN IF NOT EXISTS recovery_code TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS two_factor    TEXT NOT NULL DEFAULT '';

COMMIT;
