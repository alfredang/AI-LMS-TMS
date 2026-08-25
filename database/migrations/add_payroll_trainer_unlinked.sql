-- Migration: remember that a non-WSQ class was deliberately left unlinked.
--
-- A manually-entered class is tied to a trainer ACCOUNT by `trainer_id`, which
-- is what makes it show up in that trainer's own payout history. When Payroll
-- type a name instead of picking from the list, the server matches the name to
-- an account automatically (lib/payroll/resolveTrainer.ts).
--
-- That match is right nearly always and wrong when two people share a name —
-- one on staff with an account, one an external trainer without. Payroll can
-- refuse the match in the dialog ("Not them"), and this column is what makes
-- the refusal stick: without it, `trainer_id IS NULL` is indistinguishable from
-- "never matched yet", so the next person to open and save the class would
-- silently re-link it to the wrong trainer.
--
-- FALSE for every existing row, which is correct: nothing has been refused yet,
-- and those rows SHOULD pick up a link the first time they are edited.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.payroll_manual_class
  ADD COLUMN IF NOT EXISTS trainer_unlinked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.payroll_manual_class.trainer_unlinked IS
  'TRUE when Payroll deliberately declined to link this class to a trainer account (e.g. an external trainer who shares a name with a staff trainer). Suppresses the automatic name match on save.';

COMMIT;
