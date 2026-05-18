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
 * Shared by:
 *   - pages/api/admin/ca-send-invoice-email.ts (manual button in View)
 *   - lib/autoEnrolCompanyApplications.ts      (auto-send when toggle is ON)
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
  failures: CaInvoiceEmailFailure[];
  totalGroups: number;
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
    failures: [],
    totalGroups: 0,
  };

  const uniqueIds = Array.from(new Set(applicationIds.filter(Boolean)));
  if (!uniqueIds.length) return summary;

  const rowsRes = await pool.query(
    `SELECT id,
            invoice_id,
            invoice_doc_number,
            invoice_sent_at,
            employer_org_name,
            employer_uen,
            employer_contact_email
       FROM public.company_application
      WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );

  const groups = new Map<string, Group>();

  for (const row of rowsRes.rows) {
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
