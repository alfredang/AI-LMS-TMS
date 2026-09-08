-- Track the actual renewal of a course's funding validity (as opposed to the
-- computed "earliest renewal date" = validity end - 3 months, which is derived
-- on the fly and never stored):
--   actual_renew_date       when the renewal application was actually made
--   renewal_application_no  the SSG/TPGateway renewal application number
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS actual_renew_date date;
ALTER TABLE public.course ADD COLUMN IF NOT EXISTS renewal_application_no text;
