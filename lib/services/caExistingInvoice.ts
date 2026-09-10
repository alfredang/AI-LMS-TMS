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

/** One existing invoice, as the merge preview needs to describe it. */
export interface MergePreviewInvoice {
  invoiceId: string;
  docNumber: string;
  learnerCount: number;
  learnerNames: string[];
  /** True when the employer has it — from our own record OR from QuickBooks. */
  emailed: boolean;
  emailedAt: string | null;
  paid: boolean;
  total: number;
  /** False when this particular invoice is what stops the merge. */
  mergeable: boolean;
  blockedReason: string | null;
}

export interface MergePreview {
  employerOrgName: string;
  invoices: MergePreviewInvoice[];
  learnersOnNewInvoice: number;
  canMerge: boolean;
  /** Why not, in words an admin can act on. Null when the merge can proceed. */
  blockedReason: string | null;
}

/**
 * What merging this group WOULD do, without doing any of it.
 *
 * Deleting invoices is not something to confirm from a one-line browser prompt,
 * so this answers the questions an admin actually needs first: which documents
 * disappear, who ends up on the replacement, and whether it is allowed at all.
 *
 * Runs the same three tests the merge itself runs, and reports them per invoice
 * so a blocked group says WHICH invoice blocked it rather than just "no".
 * Read-only — nothing here writes to the database or to QuickBooks.
 */
export async function previewGroupInvoiceMerge(
  employerUen: string,
  courseRunId: string
): Promise<MergePreview> {
  const uen = String(employerUen || '').trim();
  const runId = String(courseRunId || '').trim();

  const rowsRes = await pool.query(
    `SELECT id, invoice_id, enrolment_id, grant_ineligible, billed_manually, employer_org_name
       FROM public.company_application
      WHERE LOWER(TRIM(employer_uen)) = LOWER($1)
        AND TRIM(course_run_id)       = $2`,
    [uen, runId]
  );
  const rows = rowsRes.rows;
  const invoicedRows = rows.filter(
    (r: any) => String(r.invoice_id || '').trim() && r.billed_manually !== true
  );

  const employerOrgName = String(
    rows.find((r: any) => String(r.employer_org_name || '').trim())?.employer_org_name || ''
  ).trim();

  const base = await findExistingGroupInvoices(uen, runId);

  const invoices: MergePreviewInvoice[] = [];
  let blockedReason: string | null = null;

  for (const inv of base) {
    let emailed = !!inv.sentAt;
    let paid = false;
    let total = 0;
    let reason: string | null = emailed ? 'Already emailed to the employer' : null;

    try {
      const state = await readQboInvoiceLifecycle(inv.invoiceId);
      if (state.found) {
        total = state.totalAmt;
        if (state.emailSent) {
          emailed = true;
          reason = reason || 'Emailed from QuickBooks';
        }
        if (state.hasPayment) {
          paid = true;
          reason = reason || 'A payment is recorded against it';
        }
      }
    } catch {
      reason = reason || 'Could not be read from QuickBooks';
    }

    const mergeable = !reason;
    if (!mergeable && !blockedReason) {
      blockedReason = `${inv.docNumber || inv.invoiceId}: ${reason}`;
    }
    invoices.push({
      invoiceId: inv.invoiceId,
      docNumber: inv.docNumber,
      learnerCount: inv.learnerCount,
      learnerNames: inv.learnerNames,
      emailed,
      emailedAt: inv.sentAt,
      paid,
      total,
      mergeable,
      blockedReason: reason,
    });
  }

  if (invoices.length < 2 && !blockedReason) {
    blockedReason = 'Only one invoice for this course run — nothing to merge.';
  }

  if (!blockedReason) {
    const awaiting = await findEnrolmentsAwaitingGrants(invoicedRows);
    if (awaiting.length > 0) {
      blockedReason = `${awaiting.length} learner(s) are still awaiting an SSG grant, so a replacement invoice cannot be issued yet.`;
    }
    const notEnrolled = invoicedRows.filter((r: any) => !/^ENR-/i.test(String(r.enrolment_id || '')));
    if (!blockedReason && notEnrolled.length > 0) {
      blockedReason = `${notEnrolled.length} learner(s) are not yet enroled with SSG.`;
    }
  }

  return {
    employerOrgName,
    invoices,
    learnersOnNewInvoice: invoicedRows.length,
    canMerge: !blockedReason,
    blockedReason,
  };
}
