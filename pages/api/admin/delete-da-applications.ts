import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cancelEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { voidQboInvoice } from '../../../lib/quickbooks/voidCompanyApplicationInvoice';

/**
 * POST /api/admin/delete-da-applications
 *
 * Body: { applicationIds: string[] }   // da_application.application_id values
 *
 * Cancel-then-delete for Direct Applications (mirrors ca-delete). For each row
 * that has an Enrolment ID we tear the enrolment down before removing the row:
 *   1. Cancel the SSG/TPGateway enrolment (already-cancelled is a no-op).
 *   2. Mark the native `enrollment` row Cancelled.
 *   3. Remove the learner's grant rows (ssg_grants).
 *   4. Void the QBO invoices — main tax, SFC, and grant — but ONLY when no other
 *      still-present DA row shares that invoice (DA can be batched via
 *      company_invoice_batch_id), otherwise flag it for manual adjustment.
 *   5. Delete the da_application row.
 *
 * If SSG cancel fails hard, that row is left in place (NOT deleted) so the admin
 * can retry — we never orphan a live enrolment.
 */

interface DaRow {
  application_id: string;
  trainee_name: string | null;
  employer_name: string | null;
  enrolment_id: string | null;
  course_run_id: string | null;
  invoice_id: string | null;
  sfc_invoice_id: string | null;
  grant_invoice_id: string | null;
  invoice_doc_number: string | null;
}

interface RowResult {
  application_id: string;
  trainee: string;
  deleted: boolean;
  steps: string[];
  error: string | null;
}

// Match ONLY genuine "nothing to cancel" signals — NOT a bare "cancel"
// substring, which also appears in real rejections like "cannot be cancelled".
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
    const idsRaw = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];
    const ids = Array.from(new Set(idsRaw.map((v: unknown) => String(v || '').trim()).filter(Boolean)));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'applicationIds is required' });
    }

    const rowsRes = await pool.query<DaRow>(
      `SELECT application_id, trainee_name, employer_name, enrolment_id, course_run_id,
              invoice_id, sfc_invoice_id, grant_invoice_id, invoice_doc_number
         FROM public.da_application
        WHERE application_id = ANY($1::text[])`,
      [ids]
    );
    const rows = rowsRes.rows;
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching applications found' });
    }

    const results: RowResult[] = [];
    const warnings: string[] = [];
    const deletedRows: DaRow[] = [];

    // ── Phase 1: cancel enrolment + local cleanup, then delete the row ──
    for (const row of rows) {
      const rr: RowResult = {
        application_id: row.application_id,
        trainee: row.trainee_name || '(unnamed)',
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

      // 2. Mark the native enrolment Cancelled (kept for history, matched by ref).
      // 3. Remove grant rows (keyed by the SSG enrolment reference).
      if (row.enrolment_id) {
        try {
          await pool.query(
            `UPDATE enrollment SET enrolment_status = 'Cancelled', updated_at = NOW() WHERE enrolment_id = $1`,
            [row.enrolment_id]
          );
        } catch (e) {
          console.warn('[delete-da] native enrolment cancel failed:', row.application_id, e);
        }
        try {
          const g = await pool.query(`DELETE FROM public.ssg_grants WHERE enrollment_id = $1`, [row.enrolment_id]);
          if ((g.rowCount ?? 0) > 0) rr.steps.push(`grant removed (${g.rowCount})`);
        } catch (e) {
          console.warn('[delete-da] grant delete failed:', row.application_id, e);
        }
      }

      // 4. Delete the da_application row.
      try {
        const del = await pool.query(
          `DELETE FROM public.da_application WHERE application_id = $1 RETURNING application_id`,
          [row.application_id]
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

    // ── Phase 2: void invoices no surviving application shares ──
    // Computed AFTER deletions. DA has three invoice types (main / SFC / grant).
    const voided = new Set<string>();
    const invoiceTargets: Array<{ field: keyof DaRow; docField: keyof DaRow | null; label: string }> = [
      { field: 'invoice_id', docField: 'invoice_doc_number', label: 'Tax invoice' },
      { field: 'sfc_invoice_id', docField: null, label: 'SFC invoice' },
      { field: 'grant_invoice_id', docField: null, label: 'Grant invoice' },
    ];

    for (const t of invoiceTargets) {
      const invoiceIds = Array.from(
        new Set(deletedRows.map(r => String(r[t.field] || '').trim()).filter(Boolean))
      );
      if (invoiceIds.length === 0) continue;

      const survivors = await pool.query(
        `SELECT DISTINCT ${t.field} AS inv FROM public.da_application
          WHERE ${t.field} = ANY($1::text[])`,
        [invoiceIds]
      );
      const stillShared = new Set(survivors.rows.map((r: any) => String(r.inv)));

      for (const invId of invoiceIds) {
        if (voided.has(invId)) continue;
        const sample = deletedRows.find(r => String(r[t.field] || '').trim() === invId);
        const docRaw = t.docField && sample ? sample[t.docField] : null;
        const docNo = String(docRaw || invId);
        const who = sample?.trainee_name || sample?.employer_name || '?';

        if (stillShared.has(invId)) {
          warnings.push(
            `${t.label} ${docNo} (${who}) is shared with other applications still in the system — void or adjust it manually in QuickBooks.`
          );
          continue;
        }

        const v = await voidQboInvoice(invId);
        voided.add(invId);
        if (!v.ok) {
          warnings.push(`Failed to void ${t.label.toLowerCase()} ${docNo} (${who}): ${v.message}`);
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
    console.error('delete-da-applications error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to delete applications' });
  }
}
