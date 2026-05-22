import pool from '../db';
import { qboSendInvoice } from '../services/qboInvoiceService';

/**
 * Sends one QuickBooks email per unique main tax invoice covering the given
 * Company Application row IDs.
 *
 * Recipient is the EMPLOYER contact email (NOT the trainee email) — CA
 * invoices are billed to the sponsoring company. Grant invoices are NOT
 * emailed; those are internal records billed to WSG.
 *
 * Sole caller: pages/api/admin/ca-send-invoice-email.ts (manual "Send Invoice
 * Email" button on View Company Application). No auto-send path exists —
 * verification on Check Supporting Document and invoice generation are
 * decoupled from sending.
 *
 * Server-side gates (defence in depth — UI also enforces these):
 *   - master toggle (training_provider.ca_auto_send_invoice_email) must be ON
 *   - row must have invoice_id
 *   - row must have supporting_doc_verification_status = 'verified'
 *
 * Idempotent: rows already marked invoice_sent_at are skipped. Rows sharing
 * a consolidated invoice_id fire exactly one QBO email and all share the
 * same invoice_sent_at / invoice_sent_to so the View page is consistent.
 */

export interface CaInvoiceEmailFailure {
  invoiceDocNumber: string;
  employer: string;
  error: string;
}

export interface CaInvoiceEmailSummary {
  sent: number;
  failed: number;
  skippedAlreadySent: number;
  skippedMissingEmail: number;
  skippedNoInvoice: number;
  skippedNoInvoiceRows: Array<{ id: string; employer: string }>;
  // Rows whose supporting doc isn't verified yet. Server-side mirror of the
  // UI gate — surfaces when an API caller bypasses the View page block.
  skippedNotVerified: number;
  skippedNotVerifiedRows: Array<{ id: string; employer: string }>;
  failures: CaInvoiceEmailFailure[];
  totalGroups: number;
  // True when the global toggle (training_provider.ca_auto_send_invoice_email)
  // is OFF and the call was suppressed without contacting QuickBooks. Lets
  // the caller surface a "held in test mode" message in the UI.
  toggleDisabled?: boolean;
}

interface Group {
  invoiceId: string;
  invoiceDocNumber: string;
  employerEmail: string;
  employerName: string;
  employerUen: string;
  rowIds: string[];
  anyAlreadySent: boolean;
}

export async function sendCompanyApplicationInvoiceEmails(
  applicationIds: string[]
): Promise<CaInvoiceEmailSummary> {
  const summary: CaInvoiceEmailSummary = {
    sent: 0,
    failed: 0,
    skippedAlreadySent: 0,
    skippedMissingEmail: 0,
    skippedNoInvoice: 0,
    skippedNoInvoiceRows: [],
    skippedNotVerified: 0,
    skippedNotVerifiedRows: [],
    failures: [],
    totalGroups: 0,
  };

  const uniqueIds = Array.from(new Set(applicationIds.filter(Boolean)));
  if (!uniqueIds.length) return summary;

  // Master kill switch — when the toggle on the View page is OFF, suppress
  // the manual "Send Invoice Email" send. The caller still sees a structured
  // summary so the UI can render "held in test mode" instead of pretending
  // the email went out.
  //
  // Fails closed: if the toggle query itself errors, we treat it as OFF.
  // Better to drop a real send than to silently email real employers when
  // admin believes they're in test mode (the whole point of the toggle).
  try {
    const toggleRes = await pool.query(
      `SELECT COALESCE(ca_auto_send_invoice_email, false) AS enabled
         FROM training_provider
        LIMIT 1`
    );
    const enabled = !!toggleRes.rows[0]?.enabled;
    if (!enabled) {
      return { ...summary, toggleDisabled: true };
    }
  } catch (err) {
    console.error('[sendCompanyApplicationInvoiceEmails] toggle check failed — failing closed (no send):', err);
    return { ...summary, toggleDisabled: true };
  }

  const rowsRes = await pool.query(
    `SELECT id,
            invoice_id,
            invoice_doc_number,
            invoice_sent_at,
            employer_org_name,
            employer_uen,
            employer_contact_email,
            supporting_doc_verification_status
       FROM public.company_application
      WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );

  const groups = new Map<string, Group>();

  for (const row of rowsRes.rows) {
    // Server-side verification gate. UI already blocks this case, but a direct
    // API call (or future automation) must not bypass the rule that employers
    // are only emailed once their docs are confirmed.
    const verificationStatus = String(row.supporting_doc_verification_status || '').trim().toLowerCase();
    if (verificationStatus !== 'verified') {
      summary.skippedNotVerified++;
      summary.skippedNotVerifiedRows.push({
        id: String(row.id),
        employer: String(row.employer_org_name || '').trim(),
      });
      continue;
    }
    const invoiceId = String(row.invoice_id || '').trim();
    if (!invoiceId) {
      summary.skippedNoInvoice++;
      summary.skippedNoInvoiceRows.push({
        id: String(row.id),
        employer: String(row.employer_org_name || '').trim(),
      });
      continue;
    }
    const g = groups.get(invoiceId) ?? {
      invoiceId,
      invoiceDocNumber: String(row.invoice_doc_number || '').trim(),
      employerEmail: String(row.employer_contact_email || '').trim(),
      employerName: String(row.employer_org_name || '').trim(),
      employerUen: String(row.employer_uen || '').trim(),
      rowIds: [],
      anyAlreadySent: false,
    };
    if (!g.employerEmail && row.employer_contact_email) {
      g.employerEmail = String(row.employer_contact_email).trim();
    }
    if (row.invoice_sent_at) g.anyAlreadySent = true;
    g.rowIds.push(String(row.id));
    groups.set(invoiceId, g);
  }

  summary.totalGroups = groups.size;

  for (const g of groups.values()) {
    if (g.anyAlreadySent) {
      summary.skippedAlreadySent++;
      continue;
    }
    if (!g.employerEmail) {
      summary.skippedMissingEmail++;
      summary.failures.push({
        invoiceDocNumber: g.invoiceDocNumber || g.invoiceId,
        employer: g.employerName,
        error: 'Missing employer contact email',
      });
      continue;
    }

    // Atomically claim: UPDATE only succeeds for rows where invoice_sent_at IS NULL.
    // If rowCount = 0, another concurrent caller (e.g. auto-send firing while admin
    // clicks manual Send) already claimed these rows — skip cleanly so the employer
    // never receives two emails for the same invoice. We claim BEFORE calling QBO
    // so the second caller sees the stamp; on QBO failure we roll back so retries
    // can still re-send.
    let claimed;
    try {
      claimed = await pool.query(
        `UPDATE public.company_application
            SET invoice_sent_at = now(),
                invoice_sent_to = $1,
                updated_at      = now()
          WHERE id = ANY($2::uuid[])
            AND invoice_sent_at IS NULL
          RETURNING id`,
        [g.employerEmail, g.rowIds]
      );
    } catch (claimErr) {
      summary.failed++;
      const message = claimErr instanceof Error ? claimErr.message : String(claimErr);
      summary.failures.push({
        invoiceDocNumber: g.invoiceDocNumber || g.invoiceId,
        employer: g.employerName,
        error: `Claim failed before send: ${message}`,
      });
      console.warn(
        `[ca-email] Claim UPDATE failed for invoice ${g.invoiceDocNumber || g.invoiceId}:`,
        message
      );
      continue;
    }

    if ((claimed.rowCount ?? 0) === 0) {
      // Lost the race — another worker (or a prior run) already stamped these.
      summary.skippedAlreadySent++;
      continue;
    }

    const claimedRowIds = claimed.rows.map(r => String(r.id));

    try {
      await qboSendInvoice(undefined, g.invoiceId, g.employerEmail);
      summary.sent++;
      console.log(
        `[ca-email] Sent invoice ${g.invoiceDocNumber || g.invoiceId} to ${g.employerEmail} (employer: ${g.employerName}, ${claimedRowIds.length} learner${claimedRowIds.length === 1 ? '' : 's'})`
      );
    } catch (err) {
      // Roll back the claim so a future retry can re-send. Without this rollback
      // a transient QBO error would leave the row marked "sent" forever and the
      // employer would never receive the invoice. Wrapped in try/catch (not
      // just .catch on the Promise) to also handle the edge case where
      // pool.query throws synchronously during parameter binding.
      try {
        await pool.query(
          `UPDATE public.company_application
              SET invoice_sent_at = NULL,
                  invoice_sent_to = NULL,
                  updated_at      = now()
            WHERE id = ANY($1::uuid[])`,
          [claimedRowIds]
        );
      } catch (rollbackErr) {
        console.warn(
          `[ca-email] Failed to roll back invoice_sent_at after send error for ${g.invoiceDocNumber || g.invoiceId}:`,
          rollbackErr instanceof Error ? rollbackErr.message : rollbackErr
        );
      }

      summary.failed++;
      const message = err instanceof Error ? err.message : String(err);
      summary.failures.push({
        invoiceDocNumber: g.invoiceDocNumber || g.invoiceId,
        employer: g.employerName,
        error: message,
      });
      console.warn(
        `[ca-email] Failed to send invoice ${g.invoiceDocNumber || g.invoiceId}:`,
        message
      );
    }
  }

  return summary;
}
