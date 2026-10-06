import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { cancelEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { voidQboInvoice } from '../../../lib/quickbooks/voidCompanyApplicationInvoice';
import { reissueSharedCompanyApplicationInvoice } from '../../../lib/quickbooks/createCompanyApplicationInvoice';
import { removeCaLearnerFromCalendar } from '../../../lib/google-calendar/ca-calendar-sync';

const MAX_DELETE_BATCH = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/ca-delete
 *
 * Body: { applicationIds: string[], dryRun?: boolean, confirm?: boolean }
 *
 * Cancel-then-archive. For each row that has an Enrolment ID we first tear the
 * enrolment down before archiving the tracking row:
 *   1. Cancel the SSG/TPGateway enrolment (already-cancelled is a no-op).
 *   2. Mark the native `enrollment` row Cancelled.
 *   3. Remove the learner from Google Calendar events, if present.
 *   4. For shared tax invoices, reissue a clean invoice for remaining learners
 *      when QuickBooks says the old invoice is still unsent and unpaid.
 *      Otherwise void invoices only when no other still-present learner shares
 *      them, and flag the rest for manual adjustment.
 *   5. Archive the company_application row with an audit snapshot.
 *
 * If SSG cancel fails hard, that row is left active so the
 * admin can retry - we never orphan a live enrolment.
 */

interface CaRow {
  id: string;
  enrolment_id: string | null;
  course_run_id: string | null;
  course_title: string | null;
  course_start_date: string | null;
  trainee_email: string | null;
  enrolment_status: string | null;
  auto_enrol_status: string | null;
  grant_id: string | null;
  grant_amount: string | null;
  invoice_id: string | null;
  invoice_doc_number: string | null;
  grant_invoice_id: string | null;
  grant_invoice_doc_number: string | null;
  supporting_doc_drive_file_id: string | null;
  ca_cancelled_at: string | null;
  employer_org_name: string | null;
  trainee_full_name: string | null;
}

interface RowResult {
  id: string;
  trainee: string;
  cancelled: boolean;
  archived: boolean;
  steps: string[];
  error: string | null;
}

interface PreviewRow {
  id: string;
  trainee: string;
  employer: string;
  enrolmentId: string;
  invoiceDocNumber: string;
  grantInvoiceDocNumber: string;
  actions: string[];
  blockers: string[];
}

// SSG cancel of an enrolment that's already cancelled / not on SSG is, for our
// purposes, a successful no-op rather than a failure. Match ONLY genuine
// "nothing to cancel" signals - NOT a bare "cancel" substring, which also
// appears in real rejections like "cannot be cancelled in confirmed state"
// (treating those as success would delete the row + void the invoice while the
// enrolment is still live on TPGateway).
function isAlreadyCancelled(msg: string): boolean {
  const m = (msg || '').toLowerCase();
  return (
    m.includes('already cancelled') ||
    m.includes('already been cancelled') ||
    m.includes('tgs-439') ||
    m.includes('not found') ||
    m.includes('does not exist')
  );
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const idsRaw: unknown[] = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];
    const ids: string[] = Array.from(new Set(idsRaw.map((v) => String(v || '').trim()).filter(Boolean)));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'applicationIds is required' });
    }
    const invalidIds = ids.filter(id => !UUID_RE.test(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'applicationIds must be valid Company Application row UUIDs.',
      });
    }
    if (ids.length > MAX_DELETE_BATCH) {
      return res.status(400).json({
        success: false,
        error: `Too many rows selected. Cancel at most ${MAX_DELETE_BATCH} Company Application rows at a time.`,
      });
    }

    const rowsRes = await pool.query<CaRow>(
      `SELECT id, enrolment_id, course_run_id,
              course_title, course_start_date, trainee_email,
              enrolment_status, auto_enrol_status, grant_id, grant_amount,
              invoice_id, invoice_doc_number, grant_invoice_id, grant_invoice_doc_number,
              supporting_doc_drive_file_id, ca_cancelled_at,
              employer_org_name, trainee_full_name
         FROM public.company_application
        WHERE id = ANY($1::uuid[])
          AND ca_cancelled_at IS NULL`,
      [ids]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching rows found' });
    }

    const previewRows: PreviewRow[] = rows.map((row) => {
      const blockers: string[] = [];
      const actions: string[] = ['Archive the Company Application row; it will be hidden from the normal view but kept for audit.'];
      if (row.enrolment_id) {
        if (row.course_run_id) {
          actions.push('Cancel the live SSG/TPGateway enrolment.');
          actions.push('Mark the local LMS enrolment as Cancelled.');
        } else {
          blockers.push('Missing course run id; cannot safely cancel the SSG enrolment.');
        }
      }
      if (row.trainee_email && row.course_run_id && row.course_title) {
        actions.push('Remove the learner from matching Google Calendar events.');
      }
      if (row.invoice_id) {
        actions.push('Void or reissue the tax invoice only after checking whether other active learners still share it.');
      }
      if (row.grant_invoice_id) {
        actions.push('Void the grant invoice only if no other active learner still shares it.');
      }
      if (row.supporting_doc_drive_file_id) {
        actions.push('Keep the uploaded supporting document in Drive; no Drive file will be deleted.');
      }
      return {
        id: row.id,
        trainee: row.trainee_full_name || '(unnamed)',
        employer: row.employer_org_name || '',
        enrolmentId: row.enrolment_id || '',
        invoiceDocNumber: row.invoice_doc_number || '',
        grantInvoiceDocNumber: row.grant_invoice_doc_number || '',
        actions,
        blockers,
      };
    });

    const blockedPreviewRows = previewRows.filter(r => r.blockers.length > 0);
    if (req.body?.dryRun === true) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        maxBatch: MAX_DELETE_BATCH,
        rowCount: rows.length,
        blockedCount: blockedPreviewRows.length,
        rows: previewRows,
      });
    }
    if (req.body?.confirm !== true) {
      return res.status(409).json({
        success: false,
        error: 'Preview required before cancelling Company Application rows.',
        previewRequired: true,
        maxBatch: MAX_DELETE_BATCH,
        rows: previewRows,
      });
    }
    if (blockedPreviewRows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'One or more selected rows cannot be safely cancelled.',
        rows: previewRows,
      });
    }

    const results: RowResult[] = [];
    const warnings: string[] = [];
    const archivedRows: CaRow[] = [];

    // Phase 1: cancel enrolment + local cleanup, then archive the row.
    for (const row of rows) {
      const rr: RowResult = {
        id: row.id,
        trainee: row.trainee_full_name || '(unnamed)',
        cancelled: false,
        archived: false,
        steps: [],
        error: null,
      };

      // 1. Cancel the SSG enrolment (if one was ever created).
      if (row.enrolment_id) {
        if (!row.course_run_id) {
          rr.error = 'Cannot cancel SSG enrolment - missing course run id. Row left in place.';
          results.push(rr);
          continue;
        }
        try {
          const c = await cancelEnrolment(row.enrolment_id, row.course_run_id);
          if (!c.success && !isAlreadyCancelled(c.error || '')) {
            rr.error = `SSG cancel failed: ${c.error || 'unknown error'}. Row left in place.`;
            results.push(rr);
            continue;
          }
          rr.steps.push('SSG enrolment cancelled');
        } catch (e) {
          rr.error = `SSG cancel error: ${e instanceof Error ? e.message : String(e)}. Row left in place.`;
          results.push(rr);
          continue;
        }
      }

      // 2. Mark the native enrolment Cancelled (kept for history, not deleted).
      // Matched by the SSG enrolment reference, same as the DA delete endpoint.
      if (row.enrolment_id) {
        try {
          await pool.query(
            `UPDATE enrollment SET enrolment_status = 'Cancelled', updated_at = NOW() WHERE enrolment_id = $1`,
            [row.enrolment_id]
          );
        } catch (e) {
          console.warn('[ca-delete] native enrolment cancel failed:', row.id, e);
          rr.error = `Local enrolment status update failed: ${e instanceof Error ? e.message : String(e)}. Row left in place.`;
          results.push(rr);
          continue;
        }
      }

      // 3. Remove the learner from Google Calendar events, if present.
      if (row.trainee_email && row.course_run_id && row.course_title) {
        try {
          const cal = await removeCaLearnerFromCalendar(
            row.trainee_email,
            row.course_run_id,
            row.course_title,
            row.course_start_date
          );
          if (cal.removedFrom > 0) rr.steps.push(`calendar removed (${cal.removedFrom})`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          warnings.push(`Could not remove ${rr.trainee} from Google Calendar: ${message}`);
          console.warn('[ca-delete] calendar remove failed:', row.id, message);
        }
      }

      // 4. Keep Drive evidence. The previous version deleted the supporting doc;
      // for an audit-friendly cancellation flow we retain it and archive the row.
      if (row.supporting_doc_drive_file_id) {
        rr.steps.push('supporting doc retained');
      }

      // 5. Archive the company_application row instead of hard-deleting it.
      try {
        const actor =
          (req as any).authUser?.email ||
          (req as any).authUser?.username ||
          (req as any).authUser?.id ||
          'unknown';
        const snapshot = {
          ...row,
          archivedByApi: '/api/admin/ca-delete',
          archivedAt: new Date().toISOString(),
        };
        const archived = await pool.query(
          `UPDATE public.company_application
              SET ca_cancelled_at          = NOW(),
                  ca_cancelled_by          = $2,
                  ca_cancellation_snapshot = $3::jsonb,
                  enrolment_status         = CASE WHEN COALESCE(enrolment_id, '') <> '' THEN 'Cancelled' ELSE enrolment_status END,
                  auto_enrol_status        = 'cancelled',
                  updated_at               = NOW()
            WHERE id = $1
              AND ca_cancelled_at IS NULL
            RETURNING id`,
          [row.id, String(actor), JSON.stringify(snapshot)]
        );
        if (archived.rowCount) {
          rr.cancelled = true;
          rr.archived = true;
          rr.steps.push('row archived');
          archivedRows.push(row);
        }
      } catch (e) {
        rr.error = `Failed to archive row: ${e instanceof Error ? e.message : String(e)}`;
      }
      results.push(rr);
    }

    // Phase 2: adjust or void invoices AFTER deletions.
    // A shared tax invoice can be safely reissued for the remaining learners if
    // it has not been emailed or paid. Grant invoices remain per-learner cleanup:
    // void only when no surviving learner still references them.
    const voided = new Set<string>();
    const adjustedSharedInvoices = new Set<string>();

    const invoiceTargets = [
      { field: 'invoice_id' as const, docField: 'invoice_doc_number' as const, label: 'Tax invoice' },
      { field: 'grant_invoice_id' as const, docField: 'grant_invoice_doc_number' as const, label: 'Grant invoice' },
    ];

    for (const t of invoiceTargets) {
      const invoiceIds = Array.from(
        new Set(archivedRows.map(r => String(r[t.field] || '').trim()).filter(Boolean))
      );
      if (invoiceIds.length === 0) continue;

      // Which of these invoices still have a surviving company_application row?
      const survivors = await pool.query(
        `SELECT DISTINCT ${t.field} AS inv FROM public.company_application
          WHERE ${t.field} = ANY($1::text[])
            AND ca_cancelled_at IS NULL`,
        [invoiceIds]
      );
      const stillShared = new Set(survivors.rows.map((r: any) => String(r.inv)));

      for (const invId of invoiceIds) {
        if (voided.has(invId)) continue;
        const sample = archivedRows.find(r => String(r[t.field] || '').trim() === invId);
        const docNo = String(sample?.[t.docField] || invId);
        const employer = sample?.employer_org_name || '?';

        if (stillShared.has(invId) && t.field === 'invoice_id') {
          if (adjustedSharedInvoices.has(invId)) continue;
          adjustedSharedInvoices.add(invId);
          const adjustment = await reissueSharedCompanyApplicationInvoice(invId);
          if (!adjustment.reissued) {
            warnings.push(
              `${t.label} ${docNo} (${employer}) is shared with other learners still in the system and could not be adjusted automatically: ${adjustment.reason || 'unknown reason'} Adjust it manually in QuickBooks.`
            );
          }
          continue;
        }

        if (stillShared.has(invId)) {
          warnings.push(
            `${t.label} ${docNo} (${employer}) is shared with other learners still in the system - void or adjust it manually in QuickBooks.`
          );
          continue;
        }

        const v = await voidQboInvoice(invId);
        voided.add(invId);
        if (!v.ok) {
          warnings.push(`Failed to void ${t.label.toLowerCase()} ${docNo} (${employer}): ${v.message}`);
        }
      }
    }

    const failed = results.filter(r => !r.archived);
    return res.status(200).json({
      success: true,
      cancelled: archivedRows.length,
      archived: archivedRows.length,
      failedCount: failed.length,
      warnings,
      results,
    });
  } catch (err: any) {
    console.error('ca-delete error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete rows',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
