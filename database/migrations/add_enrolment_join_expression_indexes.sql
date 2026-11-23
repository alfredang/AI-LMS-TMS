-- Expression indexes for the enrolment joins in /api/finance/all-course-runs.
--
-- That query joins invoice_jobs, ssg_grants (twice), ssg_claims, da_application and
-- company_application to each enrolment on LOWER(TRIM(COALESCE(<enrolment id>, ''))). A plain
-- column index (e.g. idx_ssg_grants_enrollment_id) cannot serve that expression, so every shown
-- enrolment scanned all of those tables (~110k rows). On 2026-11-23 one view ran 9+ minutes and
-- its read locks stalled a Bulk SFC upload and ~30 other sessions.
--
-- The expressions must stay textually identical to the query's join expressions to be used.
--
-- Also created at runtime, in the background, by ensureSsgEnrolmentGrantRollupColumns()
-- (lib/services/grantImport/ensureSsgEnrolmentGrantRollups.ts).
--
-- Additive and READ-PATH ONLY: no column, row or constraint is touched. CONCURRENTLY, so building
-- never blocks writes (run outside a transaction). Idempotent: IF NOT EXISTS.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssg_grants_enrollment_norm
  ON public.ssg_grants ((LOWER(TRIM(COALESCE(enrollment_id::text, '')))));

-- claim_id too: the query takes the latest claim (ORDER BY claim_id DESC LIMIT 1); without it the
-- planner walked the whole claim_id index backwards for every enrolment.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssg_claims_enrollment_norm_claim
  ON public.ssg_claims ((LOWER(TRIM(COALESCE(enrollment_id::text, '')))), claim_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_jobs_enrolment_norm
  ON public.invoice_jobs ((LOWER(TRIM(COALESCE(enrolment_id::text, '')))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_da_application_enrolment_norm
  ON public.da_application ((LOWER(TRIM(COALESCE(enrolment_id, '')))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_company_application_enrolment_norm
  ON public.company_application ((LOWER(TRIM(COALESCE(enrolment_id, '')))));
