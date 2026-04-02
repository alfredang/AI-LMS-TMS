-- Extend ssg_claims to support TPG "Report Details" claim exports.
-- Safe to run multiple times. Does NOT drop legacy columns.

ALTER TABLE public.ssg_claims
  ADD COLUMN IF NOT EXISTS course_name text,
  ADD COLUMN IF NOT EXISTS course_start_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS disbursement_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ready_for_payout_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payout_request_id bigint,
  ADD COLUMN IF NOT EXISTS paynow_account character varying(100),
  ADD COLUMN IF NOT EXISTS individual_nric character varying(50),
  ADD COLUMN IF NOT EXISTS sctp_declaration character varying(50),
  ADD COLUMN IF NOT EXISTS lapsed_date timestamp with time zone;

