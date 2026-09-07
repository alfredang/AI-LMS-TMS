/**
 * "Does this company already have an invoice for this class?"
 *
 * The Company Application invoice is cut per (employer UEN + course run). When
 * someone is enrolled into a class the employer has already been invoiced for,
 * the existing pipeline bills them on a SECOND invoice — correct amounts, but a
 * surprise to everyone, and the admin was never told it was about to happen.
 *
 * This module is the lookup behind that warning. It answers two things:
 *   1. which invoices already exist for the group, and who is on them
 *   2. whether any of them is still ours to take back (unsent + unpaid)
 *
 * Read-only. Nothing here deletes or creates anything — the replacement itself
 * lives in createCompanyApplicationInvoice, behind the group advisory lock.
 */

import pool from '../db';
import { readQboInvoiceLifecycle } from '../quickbooks/voidCompanyApplicationInvoice';

export interface ExistingGroupInvoice {
  invoiceId: string;
  docNumber: string;
  /** Learners currently billed on this invoice, in upload order. */
  learnerNames: string[];
  learnerCount: number;
  /** When WE emailed it to the employer. Null does not by itself mean unsent — QBO is also checked. */
  sentAt: string | null;
  driveWebViewLink: string | null;
}

export type ReplaceBlockedReason = 'sent' | 'paid' | 'qbo-unreachable';

export interface ExistingGroupInvoiceLookup {
  employerUen: string;
  courseRunId: string;
  invoices: ExistingGroupInvoice[];
  /** True when every existing invoice is still unsent and unpaid, so a replacement is possible. */
  canReplace: boolean;
  blockedReason: ReplaceBlockedReason | null;
  /** Employer name as recorded on the existing rows, for the warning copy. */
  employerOrgName: string;
}

/**
 * Every invoice already issued for this (employer, course run), with the
 * learners on it. A group legitimately carries more than one once it has been
 * billed in separate batches — which is exactly the situation this feature
 * exists to stop growing — so this always returns a list.
 */
export async function findExistingGroupInvoices(
  employerUen: string,
  courseRunId: string
): Promise<ExistingGroupInvoice[]> {
  const uen = String(employerUen || '').trim();
  const runId = String(courseRunId || '').trim();
  if (!uen || !runId) return [];

  const res = await pool.query(
    `SELECT invoice_id,
            MIN(invoice_doc_number)            AS doc_number,
            MIN(invoice_drive_web_view_link)   AS drive_link,
            MAX(invoice_sent_at)               AS sent_at,
            COUNT(*)::int                      AS learner_count,
            ARRAY_AGG(COALESCE(NULLIF(TRIM(trainee_full_name), ''), 'Unnamed')
                      ORDER BY created_at, id) AS learner_names
       FROM public.company_application
      WHERE LOWER(TRIM(employer_uen)) = LOWER($1)
        AND TRIM(course_run_id)       = $2
        AND COALESCE(invoice_id, '') <> ''
      GROUP BY invoice_id
      ORDER BY MIN(created_at)`,
    [uen, runId]
  );

  return res.rows.map((r: any) => ({
    invoiceId: String(r.invoice_id),
    docNumber: String(r.doc_number || ''),
    learnerNames: Array.isArray(r.learner_names) ? r.learner_names.map((n: any) => String(n)) : [],
    learnerCount: Number(r.learner_count) || 0,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    driveWebViewLink: r.drive_link ? String(r.drive_link) : null,
  }));
}

/**
 * Is every one of these invoices still ours to delete?
 *
 * An invoice is out of reach once the employer has it or has paid against it.
 * Both are read from QuickBooks as well as our own `invoice_sent_at`, because
 * either can happen outside the LMS — Finance forwarding a copy from QBO, or
 * recording a payment by hand.
 *
 * A QuickBooks read failure returns NOT replaceable. Guessing "probably fine"
 * here would delete an invoice a customer is holding.
 */
export async function assessReplaceEligibility(
  invoices: ExistingGroupInvoice[]
): Promise<{ canReplace: boolean; blockedReason: ReplaceBlockedReason | null }> {
  if (invoices.length === 0) return { canReplace: false, blockedReason: null };

  for (const inv of invoices) {
    if (inv.sentAt) return { canReplace: false, blockedReason: 'sent' };

    let state;
    try {
      state = await readQboInvoiceLifecycle(inv.invoiceId);
    } catch (err) {
      console.warn(
        `[ca-existing-invoice] Could not read invoice ${inv.docNumber || inv.invoiceId} from QuickBooks:`,
        err instanceof Error ? err.message : err
      );
      return { canReplace: false, blockedReason: 'qbo-unreachable' };
    }

    // Already gone from QuickBooks — nothing to take back, and nothing blocking
    // us either. Treated as replaceable so the stale row can be re-billed.
    if (!state.found) continue;
    if (state.emailSent) return { canReplace: false, blockedReason: 'sent' };
    if (state.hasPayment) return { canReplace: false, blockedReason: 'paid' };
  }

  return { canReplace: true, blockedReason: null };
}

/** Convenience wrapper: the lookup plus its replace verdict, as the popup needs it. */
export async function lookupExistingGroupInvoices(
  employerUen: string,
  courseRunId: string
): Promise<ExistingGroupInvoiceLookup> {
  const invoices = await findExistingGroupInvoices(employerUen, courseRunId);
  const { canReplace, blockedReason } = await assessReplaceEligibility(invoices);

  let employerOrgName = '';
  if (invoices.length > 0) {
    const nameRes = await pool.query(
      `SELECT employer_org_name
         FROM public.company_application
        WHERE LOWER(TRIM(employer_uen)) = LOWER($1)
          AND TRIM(course_run_id)       = $2
          AND COALESCE(employer_org_name, '') <> ''
        LIMIT 1`,
      [String(employerUen).trim(), String(courseRunId).trim()]
    );
    employerOrgName = String(nameRes.rows[0]?.employer_org_name || '');
  }

  return {
    employerUen: String(employerUen).trim(),
    courseRunId: String(courseRunId).trim(),
    invoices,
    canReplace,
    blockedReason,
    employerOrgName,
  };
}

/**
 * Which of these enrolments SSG has not granted yet.
 *
 * Mirrors the guard in generateInvoicesForApplications: a learner counts as
 * settled once ssg_grants holds a non-cancelled row with a positive approved OR
 * estimated amount, or the admin has marked them Not Grant Eligible.
 *
 * The replacement path needs this BEFORE it deletes anything. An invoice is only
 * created once every learner in the group is settled, so deleting while the late
 * joiner is still waiting on SSG would leave the employer with no invoice at all
 * until the grant lands — days, sometimes.
 */
export async function findEnrolmentsAwaitingGrants(
  rows: Array<{ enrolment_id?: string | null; grant_ineligible?: boolean | null }>
): Promise<string[]> {
  const candidates = rows.filter(r => r.grant_ineligible !== true);
  const enrolmentIds = candidates
    .map(r => String(r.enrolment_id || '').toLowerCase().trim())
    .filter(Boolean);
  if (enrolmentIds.length === 0) return [];

  const res = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(enrollment_id)) AS enrolment_key
       FROM public.ssg_grants
      WHERE LOWER(TRIM(enrollment_id)) = ANY($1::text[])
        AND COALESCE(status, '') <> 'Cancelled'
        AND (
          COALESCE(approved_grant_amount, 0) > 0
          OR COALESCE(estimated_grant_amount, 0) > 0
        )`,
    [enrolmentIds]
  );
  const settled = new Set<string>(res.rows.map((r: any) => String(r.enrolment_key)));

  return enrolmentIds.filter(id => !settled.has(id));
}
