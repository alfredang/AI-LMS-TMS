import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { cancelEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { voidQboInvoice } from '../../../lib/quickbooks/voidCompanyApplicationInvoice';

/**
 * POST /api/admin/ca-delete
 *
 * Body: { applicationIds: string[] }   // company_application.id UUIDs
 *
 * Cancel-then-delete. For each row that has an Enrolment ID we first tear the
 * enrolment down before removing the tracking row:
 *   1. Cancel the SSG/TPGateway enrolment (already-cancelled is a no-op).
 *   2. Mark the native `enrollment` row Cancelled.
 *   3. Remove the learner's grant rows (ssg_grants).
 *   4. Void the QBO tax + grant invoice ONLY if no other still-present learner
 *      shares it (consolidated invoices cover multiple learners) — otherwise
 *      flag it for manual adjustment.
 *   5. Delete the company_application row.
 *
 * If SSG cancel fails hard, that row is left untouched (NOT deleted) so the
 * admin can retry — we never orphan a live enrolment.
 */

interface CaRow {
  id: string;
  enrolment_id: string | null;
  course_run_id: string | null;
  invoice_id: string | null;
  invoice_doc_number: string | null;
  grant_invoice_id: string | null;
  grant_invoice_doc_number: string | null;
  employer_org_name: string | null;
  trainee_full_name: string | null;
}

interface RowResult {
  id: string;
  trainee: string;
  deleted: boolean;
  steps: string[];
  error: string | null;
}

// SSG cancel of an enrolment that's already cancelled / not on SSG is, for our
// purposes, a successful no-op rather than a failure. Match ONLY genuine
// "nothing to cancel" signals — NOT a bare "cancel" substring, which also
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const idsRaw = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];
    const ids = Array.from(new Set(idsRaw.map((v: unknown) => String(v || '').trim()).filter(Boolean)));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'applicationIds is required' });
    }

    const rowsRes = await pool.query<CaRow>(
      `SELECT id, enrolment_id, course_run_id,
              invoice_id, invoice_doc_number, grant_invoice_id, grant_invoice_doc_number,
              employer_org_name, trainee_full_name
         FROM public.company_application
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching rows found' });
    }

    const results: RowResult[] = [];
    const warnings: string[] = [];
    const deletedRows: CaRow[] = [];

    // ── Phase 1: cancel enrolment + local cleanup, then delete the row ──
    for (const row of rows) {
      const rr: RowResult = {
        id: row.id,
        trainee: row.trainee_full_name || '(unnamed)',
        deleted: false,
        steps: [],
        error: null,
      };

      // 1. Cancel the SSG enrolment (if one was ever created).
      if (row.enrolment_id) {
        if (!row.course_run_id) {
          rr.error = 'Cannot cancel SSG enrolment — missing course run id. Row left in place.';
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
        }
      }

      // 3. Remove grant rows (keyed by the SSG enrolment reference).
      if (row.enrolment_id) {
        try {
          const g = await pool.query(`DELETE FROM public.ssg_grants WHERE enrollment_id = $1`, [row.enrolment_id]);
          if ((g.rowCount ?? 0) > 0) rr.steps.push(`grant removed (${g.rowCount})`);
        } catch (e) {
          console.warn('[ca-delete] grant delete failed:', row.id, e);
        }
      }

      // 4. Delete the company_application row.
      try {
        const del = await pool.query(
          `DELETE FROM public.company_application WHERE id = $1 RETURNING id`,
          [row.id]
        );
        if (del.rowCount) {
          rr.deleted = true;
          deletedRows.push(row);
        }
      } catch (e) {
        rr.error = `Failed to delete row: ${e instanceof Error ? e.message : String(e)}`;
      }
      results.push(rr);
    }

    // ── Phase 2: void invoices, but only those no surviving learner shares ──
    // Computed AFTER deletions so a consolidated invoice is voided only when
    // every learner on it is now gone.
    const voided = new Set<string>();

    const invoiceTargets = [
      { field: 'invoice_id' as const, docField: 'invoice_doc_number' as const, label: 'Tax invoice' },
      { field: 'grant_invoice_id' as const, docField: 'grant_invoice_doc_number' as const, label: 'Grant invoice' },
    ];

    for (const t of invoiceTargets) {
      const invoiceIds = Array.from(
        new Set(deletedRows.map(r => String(r[t.field] || '').trim()).filter(Boolean))
      );
      if (invoiceIds.length === 0) continue;

      // Which of these invoices still have a surviving company_application row?
      const survivors = await pool.query(
        `SELECT DISTINCT ${t.field} AS inv FROM public.company_application
          WHERE ${t.field} = ANY($1::text[])`,
        [invoiceIds]
      );
      const stillShared = new Set(survivors.rows.map((r: any) => String(r.inv)));

      for (const invId of invoiceIds) {
        if (voided.has(invId)) continue;
        const sample = deletedRows.find(r => String(r[t.field] || '').trim() === invId);
        const docNo = String(sample?.[t.docField] || invId);
        const employer = sample?.employer_org_name || '?';

        if (stillShared.has(invId)) {
          warnings.push(
            `${t.label} ${docNo} (${employer}) is shared with other learners still in the system — void or adjust it manually in QuickBooks.`
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

    const failed = results.filter(r => !r.deleted);
    return res.status(200).json({
      success: true,
      deleted: deletedRows.length,
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
