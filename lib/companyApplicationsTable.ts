import pool from './db';

let ensurePromise: Promise<void> | null = null;

const ORDERED_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'course_title', type: 'text' },
  { name: 'course_start_date', type: 'text' },
  { name: 'trainee_identity_type', type: 'text' },
  { name: 'trainee_full_name', type: 'text' },
  { name: 'trainee_id_type', type: 'text' },
  { name: 'trainee_nric', type: 'text' },
  { name: 'date_of_birth', type: 'text' },
  { name: 'trainee_email', type: 'text' },
  { name: 'trainee_phone', type: 'text' },
  { name: 'trainee_highest_qualification', type: 'text' },
  { name: 'employer_org_name', type: 'text' },
  { name: 'employer_uen', type: 'text' },
  { name: 'employer_contact_name', type: 'text' },
  { name: 'employer_contact_designation', type: 'text' },
  { name: 'employer_contact_phone', type: 'text' },
  { name: 'employer_contact_email', type: 'text' },
  { name: 'ssg_funding_before', type: 'text' },
  { name: 'consent_ssg_terms', type: 'text' },
  { name: 'declaration_truthful', type: 'text' },
  { name: 'consent_marketing', type: 'text' },
  { name: 'grant_application_nos', type: 'text' },
  { name: 'course_reference_number', type: 'text' },
  { name: 'course_run_id', type: 'text' },
  { name: 'enrolment_id', type: 'text' },
  { name: 'enrolment_status', type: 'text' },
  { name: 'grant_id', type: 'text' },
  { name: 'grant_amount', type: 'numeric' },
  { name: 'auto_enrol_status', type: 'text' },
  { name: 'auto_enrol_error', type: 'text' },
  { name: 'calendar_added', type: 'boolean DEFAULT false' },
  // Marks a learner as permanently grant-ineligible (e.g. non-citizen, age
  // out of band). Set via the View page toggle. The invoice guard treats
  // these rows as if they had a grant — so the group can be billed at full
  // fee for the ineligible learner without blocking the rest of the group.
  { name: 'grant_ineligible', type: 'boolean DEFAULT false' },
  // Late joiner billing, chosen by the admin when they enrol someone into a
  // class whose employer invoice already exists (see ca-existing-invoice):
  //
  //   billed_manually — "Enrol only". We never invoice this learner; Finance
  //     adds them to the existing invoice in QuickBooks by hand. The flag is
  //     what makes that safe: a row with no invoice_id and no flag is
  //     indistinguishable from an unbilled one, so the next Generate Invoice
  //     click would cut exactly the duplicate the admin was avoiding.
  //   billed_manually_invoice_ref — the DocNumber they are being added to.
  //     Informational on the View page, and used as the grant invoice's PO#
  //     so that cross-reference stays correct.
  //   replace_group_invoice — "Replace". Intent, not an action: the existing
  //     invoice can only be swapped once this learner is enroled AND their
  //     grant has landed, which is long after the enrolment click. The
  //     invoice sweep honours it when the group is finally billable.
  { name: 'billed_manually', type: 'boolean DEFAULT false' },
  { name: 'billed_manually_invoice_ref', type: 'text' },
  { name: 'replace_group_invoice', type: 'boolean DEFAULT false' },
  { name: 'invoice_id', type: 'text' },
  { name: 'invoice_doc_number', type: 'text' },
  { name: 'invoice_drive_file_id', type: 'text' },
  { name: 'invoice_drive_web_view_link', type: 'text' },
  { name: 'invoice_sent_at', type: 'timestamptz' },
  { name: 'invoice_sent_to', type: 'text' },
  { name: 'grant_invoice_id', type: 'text' },
  { name: 'grant_invoice_doc_number', type: 'text' },
  { name: 'grant_invoice_drive_file_id', type: 'text' },
  { name: 'grant_invoice_drive_web_view_link', type: 'text' },
  // Non-blocking step failures from the auto-enrol pipeline (grant fetch,
  // calendar sync, native LMS enrolment, partial grant upsert). Each entry:
  // { step, error, at }. The View page surfaces rows with non-empty
  // warnings so admins can see partial failures even when auto_enrol_status
  // isn't 'failed'. ca-stuck-count drives the sidebar badge off this.
  { name: 'pipeline_warnings', type: "jsonb DEFAULT '[]'::jsonb" },
  // Supporting-document verification — gates invoice email sending. Admin
  // uploads a doc per learner (NRIC/payslip/CPF/etc.), reviews it side-by-
  // side against the Excel row in the SupportingDocsModal, and confirms
  // each field (trainee full name, NRIC, employer name, UEN) matches.
  // Only after status='verified' does the invoice email auto-send.
  // status values: NULL/pending (no doc yet) | verified (admin approved) |
  // mismatch (admin flagged at least one field; doc must be re-uploaded).
  { name: 'supporting_doc_drive_file_id', type: 'text' },
  { name: 'supporting_doc_drive_web_view_link', type: 'text' },
  { name: 'supporting_doc_uploaded_at', type: 'timestamptz' },
  { name: 'supporting_doc_verification_status', type: 'text' },
  { name: 'supporting_doc_verified_at', type: 'timestamptz' },
  { name: 'supporting_doc_verified_by', type: 'text' },
];

/**
 * Append a non-blocking pipeline warning to a company_application row.
 * Used by the auto-enrol pipeline to record per-step failures (grant fetch,
 * calendar sync, native LMS enrolment, partial grant upsert) without
 * flipping auto_enrol_status to 'failed' — the SSG enrolment itself may
 * have succeeded but a downstream step needs admin attention.
 *
 * Safe to call with a missing rowId (no-op), and silently swallows DB
 * errors so warning-write failures never cascade into the caller.
 */
export async function appendPipelineWarning(
  rowId: string,
  step: string,
  error: unknown,
): Promise<void> {
  if (!rowId) return;
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error);
  const warning = {
    step,
    error: message.slice(0, 1000),
    at: new Date().toISOString(),
  };
  try {
    await pool.query(
      `UPDATE public.company_application
          SET pipeline_warnings = COALESCE(pipeline_warnings, '[]'::jsonb) || $2::jsonb,
              updated_at        = now()
        WHERE id = $1`,
      [rowId, JSON.stringify(warning)],
    );
  } catch (e) {
    console.error('[appendPipelineWarning] failed:', e);
  }
}

export function ensureCompanyApplicationsTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const columnDefs = ORDERED_COLUMNS.map(c => `${c.name} ${c.type}`).join(',\n        ');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.company_application (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          ${columnDefs},
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      for (const col of ORDERED_COLUMNS) {
        await pool.query(
          `ALTER TABLE public.company_application ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
        );
      }

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_company_application_employer_uen
          ON public.company_application(employer_uen);
        CREATE INDEX IF NOT EXISTS idx_company_application_trainee_email
          ON public.company_application(trainee_email);
        CREATE INDEX IF NOT EXISTS idx_company_application_dedup
          ON public.company_application (
            LOWER(TRIM(COALESCE(trainee_nric, ''))),
            LOWER(TRIM(COALESCE(employer_uen, ''))),
            LOWER(TRIM(COALESCE(course_title, ''))),
            LOWER(TRIM(COALESCE(course_start_date, '')))
          );
      `);

      // Belt-and-braces: a UNIQUE partial index that physically prevents two
      // concurrent uploads from inserting duplicate (trainee, employer, course,
      // start-date) rows. The application-layer SELECT-then-INSERT pattern in
      // upload-company-applications.ts can race; this stops the race at the DB.
      //
      // Partial (WHERE clause) so incomplete rows (missing nric/title/date)
      // are NOT constrained — those are bad data that should be caught by
      // validation, not blocked at the DB layer with an opaque 23505 error.
      //
      // Existing duplicates would block index creation, so we collapse them
      // first by keeping the newest row per dedup key and deleting the rest.
      // Safe because the collapsed rows have identical critical fields.
      await pool.query(`
        WITH dups AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY
                     LOWER(TRIM(trainee_nric)),
                     LOWER(TRIM(COALESCE(employer_uen, ''))),
                     LOWER(TRIM(course_title)),
                     LOWER(TRIM(course_start_date))
                   ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                 ) AS rn
            FROM public.company_application
           WHERE trainee_nric IS NOT NULL AND trainee_nric <> ''
             AND course_title IS NOT NULL AND course_title <> ''
             AND course_start_date IS NOT NULL AND course_start_date <> ''
        )
        DELETE FROM public.company_application
         WHERE id IN (SELECT id FROM dups WHERE rn > 1);
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_company_application_dedup
          ON public.company_application (
            LOWER(TRIM(trainee_nric)),
            LOWER(TRIM(COALESCE(employer_uen, ''))),
            LOWER(TRIM(course_title)),
            LOWER(TRIM(course_start_date))
          )
          WHERE trainee_nric IS NOT NULL AND trainee_nric <> ''
            AND course_title IS NOT NULL AND course_title <> ''
            AND course_start_date IS NOT NULL AND course_start_date <> '';
      `);
    })();

    // Reset on rejection so a transient failure on first boot doesn't poison
    // the singleton forever — next call will re-attempt setup.
    ensurePromise.catch(() => {
      ensurePromise = null;
    });
  }

  return ensurePromise;
}
