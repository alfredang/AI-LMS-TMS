-- Migration: Trainer billing invoices (QuickBooks Bills) for the Payroll role
-- Adds:
--   trainer_bill table — one row per confirmed trainer payout, carrying the
--   generated bill number and the QuickBooks Bill it was posted as.
--
-- One class = one bill. There is deliberately NO consolidation across classes
-- or trainers: each (payout row) → exactly one bill, enforced by the partial
-- unique indexes on payout_id / manual_class_id below.
--
-- Bill numbers are NOT allocated by this feature. lib/payroll/billNo.ts stamps
-- every payout with a TX ref at creation (TX + YYMMDD of the CLASS START DATE +
-- a 2-digit per-day sequence shared across both payout tables), and a bill is
-- raised under that same ref — so the Payout List and the QuickBooks DocNumber
-- always read the same string.
--
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS public.trainer_bill (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which payout table this bill belongs to. Exactly one of the two id
    -- columns is set; 'wsq' -> trainer_payout, 'manual' -> payroll_manual_class.
    source TEXT NOT NULL CHECK (source IN ('wsq','manual')),

    -- SET NULL, never CASCADE. This row is the only LMS record of a real
    -- payable in QuickBooks, and the class it came from can be deleted from
    -- outside Payroll (course_run cascades into trainer_payout). Cascading
    -- further would erase the only trail to a bill still live in QBO, with
    -- nothing left to reconcile against. The row survives instead: parentless,
    -- but still carrying bill_no / qb_bill_id / the Drive link.
    payout_id       UUID REFERENCES public.trainer_payout(id) ON DELETE SET NULL,
    manual_class_id UUID REFERENCES public.payroll_manual_class(id) ON DELETE SET NULL,

    -- "Never both", not "exactly one": after a parent is deleted the owning
    -- side is null, and `source` stays the discriminator.
    CONSTRAINT trainer_bill_one_source CHECK (
        (source = 'wsq'    AND manual_class_id IS NULL)
     OR (source = 'manual' AND payout_id IS NULL)
    ),

    -- Unique among LIVE bills only (idx_trainer_bill_no_live below), NOT
    -- table-wide: the ref belongs to the payout, so un-confirming and then
    -- re-confirming raises a new bill under the same number.
    bill_no   TEXT NOT NULL,
    bill_date DATE NOT NULL,

    -- Snapshot of the class/trainer at the moment the payout was confirmed.
    -- Kept denormalised so the bill list still reads correctly after a class
    -- is edited, a trainer is reassigned, or a course is renamed.
    trainer_id   UUID,
    trainer_name TEXT NOT NULL,
    course_title TEXT NOT NULL,
    course_code  TEXT,
    amount       NUMERIC(12,2) NOT NULL,

    -- QuickBooks side. vendor_* is the resolved/created Supplier; qb_bill_id is
    -- the posted Bill's Id (null until the push succeeds).
    vendor_ref   TEXT,
    vendor_name  TEXT,
    qb_bill_id   TEXT,

    -- The generated PDF in Google Drive. drive_file_id is kept so a deleted /
    -- trashed file can be detected and re-uploaded; drive_view_link is what the
    -- Payroll "View PDF" button opens.
    drive_file_id   TEXT,
    drive_view_link TEXT,

    -- pending = number reserved, not yet in QBO
    -- posted   = live in QBO
    -- failed   = push failed, retryable (error holds the reason)
    -- voided   = payout was un-confirmed; bill deleted in QBO. The number stays
    --            on the payout and is reused if it is confirmed again.
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','posted','failed','voided')),
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.app_user(id)
);

-- Older builds created bill_no as table-wide UNIQUE; re-confirming a payout
-- under its own number would fail against that.
ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_bill_no_key;

-- Additive, for tables created before the Drive PDF was added.
ALTER TABLE public.trainer_bill ADD COLUMN IF NOT EXISTS drive_file_id   TEXT;
ALTER TABLE public.trainer_bill ADD COLUMN IF NOT EXISTS drive_view_link TEXT;

-- Discard withdrawn bills that never reached QuickBooks: no QBO document, no
-- Drive file, nothing to reconcile against. Cannot match a bill that posted.
DELETE FROM public.trainer_bill WHERE status = 'voided' AND qb_bill_id IS NULL;

-- Move a table created by an earlier build off ON DELETE CASCADE (see the
-- reasoning on the column definitions above). Drop-then-add keeps this
-- re-runnable.
ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_payout_id_fkey;
ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_payout_id_fkey
    FOREIGN KEY (payout_id) REFERENCES public.trainer_payout(id) ON DELETE SET NULL;

ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_manual_class_id_fkey;
ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_manual_class_id_fkey
    FOREIGN KEY (manual_class_id) REFERENCES public.payroll_manual_class(id) ON DELETE SET NULL;

ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_one_source;
ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_one_source CHECK (
    (source = 'wsq'    AND manual_class_id IS NULL)
 OR (source = 'manual' AND payout_id IS NULL)
);

-- One live bill per number, and per payout. Both partial (WHERE status <>
-- 'voided') so that un-confirming and re-confirming a payout can raise a fresh
-- bill without colliding with the voided one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_no_live
    ON public.trainer_bill(bill_no)
    WHERE status <> 'voided';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_payout_live
    ON public.trainer_bill(payout_id)
    WHERE payout_id IS NOT NULL AND status <> 'voided';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_manual_live
    ON public.trainer_bill(manual_class_id)
    WHERE manual_class_id IS NOT NULL AND status <> 'voided';

CREATE INDEX IF NOT EXISTS idx_trainer_bill_status  ON public.trainer_bill(status);
CREATE INDEX IF NOT EXISTS idx_trainer_bill_date    ON public.trainer_bill(bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_bill_trainer ON public.trainer_bill(trainer_id);

DROP TRIGGER IF EXISTS trainer_bill_touch_updated_at ON public.trainer_bill;
CREATE TRIGGER trainer_bill_touch_updated_at
    BEFORE UPDATE ON public.trainer_bill
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.trainer_bill IS
  'QuickBooks supplier Bills raised for confirmed trainer payouts. One class = one bill (never consolidated). bill_no is the ref already stamped on the payout by lib/payroll/billNo.ts, not a separate sequence.';

COMMIT;
