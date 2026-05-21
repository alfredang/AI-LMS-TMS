import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { requireSfcImportSchema } from '@/lib/services/sfcImport/sfcImportDb';

const BASE_URL =
  process.env.QBO_PROXY_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
  'http://localhost:3000';

function enrolmentLast6(enrolmentId: string): string {
  const digits = String(enrolmentId || '').replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  if (digits.length > 0) return digits.padStart(6, '0').slice(-6);
  return '';
}

/**
 * Customer invoice DocNumber format. Grant (GRN-…) and SFC supplemental
 * invoices share the enrolment suffix and would otherwise collide here.
 */
const CUSTOMER_INVOICE_DOC_NUMBER_RE = /^TC\d{2}-\d{4}-\d{6}$/i;
function isCustomerInvoiceDocNumber(docNumber: string | null | undefined): boolean {
  return CUSTOMER_INVOICE_DOC_NUMBER_RE.test(String(docNumber || '').trim());
}

async function qbFetchAllInvoices(app: string): Promise<Array<{ id: string; docNumber: string | null }>> {
  const all: Array<{ id: string; docNumber: string | null }> = [];
  let startPos = 1;
  while (true) {
    try {
      const resp = await fetch(`${BASE_URL}/api/quickbooks/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          entity: 'invoice',
          app,
          query: `SELECT Id, DocNumber FROM Invoice ORDERBY TxnDate DESC STARTPOSITION ${startPos} MAXRESULTS 1000`,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) break;
      const rows = data?.data?.QueryResponse?.Invoice;
      const page: any[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
      for (const r of page) {
        all.push({ id: String(r.Id), docNumber: r.DocNumber ? String(r.DocNumber) : null });
      }
      if (page.length < 1000) break;
      startPos += 1000;
    } catch {
      break;
    }
  }
  return all;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    await requireFinanceOrAdmin(req);
    await requireSfcImportSchema();

    // All unmatched rows that have an enrolment_id but no QB invoice yet
    const r = await pool.query(
      `SELECT id, matched_enrolment_id
       FROM public.sfc_import_rows
       WHERE batch_id = $1::int
         AND match_status = 'unmatched'
         AND matched_enrolment_id IS NOT NULL
         AND matched_qbo_invoice_id IS NULL
       ORDER BY row_index ASC`,
      [batchId]
    );

    const unmatchedRows = r.rows as Array<{ id: number; matched_enrolment_id: string }>;
    const total = unmatchedRows.length;

    if (total === 0) {
      return res.status(200).json({ success: true, data: { resolved: 0, notFound: 0, errors: 0, total: 0 } });
    }

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
    const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

    let resolved = 0;
    let notFound = 0;
    let errors = 0;

    // Step 1: Fix invoice_jobs rows that already have qbo_invoice_id but wrong status
    await pool.query(
      `UPDATE public.invoice_jobs SET status = 'done', updated_at = now()
       WHERE status != 'done' AND qbo_invoice_id IS NOT NULL`
    );

    // Step 2: Build last6 → enrolment map for bulk QB scan
    const last6Map = new Map<string, string>(); // last6 → enrolment_id (unique only)
    const enrolmentIdSet = new Set<string>();
    for (const row of unmatchedRows) {
      const eid = String(row.matched_enrolment_id || '').trim();
      if (!eid) continue;
      const l6 = enrolmentLast6(eid);
      if (!l6) continue;
      if (last6Map.has(l6)) {
        last6Map.delete(l6); // collision — skip ambiguous entries
      } else {
        last6Map.set(l6, eid);
        enrolmentIdSet.add(eid);
      }
    }

    // Step 3: Check invoice_jobs for already-done entries (handles status fix from Step 1)
    const alreadyDone = await pool.query(
      `SELECT enrolment_id::text AS enrolment_id,
              qbo_invoice_id::text AS qbo_invoice_id,
              qbo_doc_number::text AS qbo_doc_number
       FROM public.invoice_jobs
       WHERE status = 'done'
         AND qbo_invoice_id IS NOT NULL
         AND LOWER(TRIM(enrolment_id)) = ANY(
           SELECT LOWER(TRIM(unnest($1::text[])))
         )`,
      [Array.from(enrolmentIdSet)]
    );
    const doneMap = new Map<string, { qboInvoiceId: string; qboDocNumber: string | null }>();
    for (const r of alreadyDone.rows) {
      doneMap.set(String(r.enrolment_id).toLowerCase().trim(), {
        qboInvoiceId: String(r.qbo_invoice_id),
        qboDocNumber: r.qbo_doc_number ? String(r.qbo_doc_number) : null,
      });
    }

    // Step 4: Bulk-fetch all QB invoices (paginated) and match by last-6 DocNumber suffix.
    // Only TC-format customer invoices are eligible — GRN-/SFC- supplemental invoices share
    // the enrolment suffix and would otherwise be misattributed.
    const qbInvoiceByLast6 = new Map<string, { id: string; docNumber: string }>();
    for (const app of apps) {
      const allInvoices = await qbFetchAllInvoices(app);
      for (const inv of allInvoices) {
        if (!inv.docNumber) continue;
        if (!isCustomerInvoiceDocNumber(inv.docNumber)) continue;
        const suffix = inv.docNumber.slice(-6);
        if (last6Map.has(suffix) && !qbInvoiceByLast6.has(suffix)) {
          qbInvoiceByLast6.set(suffix, { id: inv.id, docNumber: inv.docNumber });
        }
      }
    }

    // Step 5: Update each unmatched row
    for (const row of unmatchedRows) {
      try {
        const enrolmentId = String(row.matched_enrolment_id || '').trim();
        if (!enrolmentId) { errors++; continue; }

        // Check done map first (fastest)
        const done = doneMap.get(enrolmentId.toLowerCase().trim());
        let qboInvoiceId: string | null = done?.qboInvoiceId ?? null;
        let qboDocNumber: string | null = done?.qboDocNumber ?? null;

        // Fall back to bulk QB scan result
        if (!qboInvoiceId) {
          const l6 = enrolmentLast6(enrolmentId);
          const match = l6 ? qbInvoiceByLast6.get(l6) : undefined;
          if (match) {
            qboInvoiceId = match.id;
            qboDocNumber = match.docNumber;

            // Upsert into invoice_jobs
            const enrData = await pool.query(
              `SELECT e.user_id::text AS user_id, u.email::text AS learner_email, COALESCE(e.course_reference::text,'') AS course_code
               FROM enrollment e LEFT JOIN app_user u ON u.id = e.user_id
               WHERE LOWER(TRIM(COALESCE(e.enrolment_id::text,''))) = LOWER(TRIM($1::text)) LIMIT 1`,
              [enrolmentId]
            );
            const enrRow = enrData.rows[0] as { user_id: string; learner_email: string; course_code: string } | undefined;
            await pool.query(
              `INSERT INTO public.invoice_jobs (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id, qbo_doc_number)
               VALUES ($1::text, COALESCE($2::uuid, gen_random_uuid()), $3::text, $4::text, 'done', $5::varchar, $6::varchar)
               ON CONFLICT (enrolment_id) DO UPDATE SET qbo_invoice_id=EXCLUDED.qbo_invoice_id, qbo_doc_number=EXCLUDED.qbo_doc_number, status='done', updated_at=now()`,
              [enrolmentId, enrRow?.user_id || null, enrRow?.learner_email || '', enrRow?.course_code || '', qboInvoiceId, qboDocNumber]
            );
          }
        }

        if (!qboInvoiceId) { notFound++; continue; }

        await pool.query(
          `UPDATE public.sfc_import_rows SET
             matched_qbo_invoice_id = $2::varchar,
             matched_qbo_doc_number = $3::varchar,
             match_status = 'ready',
             apply_status = NULL,
             apply_error = NULL
           WHERE id = $1::int AND batch_id = $4::int`,
          [row.id, qboInvoiceId, qboDocNumber, batchId]
        );
        resolved++;
      } catch (e) {
        errors++;
        console.error('[sfc-import/sync-invoice-ids] row error:', e instanceof Error ? e.message : e);
      }
    }

    // Recompute batch match counts
    if (resolved > 0) {
      await pool.query(
        `UPDATE public.sfc_import_batches b SET
           ready_count = x.ready_count,
           unmatched_count = x.unmatched_count
         FROM (
           SELECT batch_id,
             COUNT(*) FILTER (WHERE match_status = 'ready')::int AS ready_count,
             COUNT(*) FILTER (WHERE match_status = 'unmatched')::int AS unmatched_count
           FROM public.sfc_import_rows
           WHERE batch_id = $1
           GROUP BY batch_id
         ) x
         WHERE b.id = $1 AND b.id = x.batch_id`,
        [batchId]
      );
    }

    return res.status(200).json({ success: true, data: { resolved, notFound, errors, total } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}
