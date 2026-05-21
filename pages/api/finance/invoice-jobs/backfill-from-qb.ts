import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';

const BASE_URL =
  process.env.QBO_PROXY_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
  'http://localhost:3000';

type QbInvoice = { id: string; docNumber: string | null };

async function qbQuery(app: string, query: string): Promise<any[] | null> {
  try {
    const resp = await fetch(`${BASE_URL}/api/quickbooks/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', entity: 'invoice', app, query }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.success) return null;
    const rows = data?.data?.QueryResponse?.Invoice;
    return Array.isArray(rows) ? rows : rows ? [rows] : [];
  } catch {
    return null;
  }
}

/** Fetch invoices by exact DocNumber list using IN clause (DocNumber IS filterable in QBO). */
async function qbFindByDocNumbers(app: string, docNumbers: string[]): Promise<QbInvoice[]> {
  if (docNumbers.length === 0) return [];
  const safe = docNumbers.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(', ');
  const rows = await qbQuery(app, `SELECT Id, DocNumber FROM Invoice WHERE DocNumber IN (${safe}) MAXRESULTS 1000`);
  if (!rows) return [];
  return rows.map((r: any) => ({ id: String(r.Id), docNumber: r.DocNumber ? String(r.DocNumber) : null }));
}

/** Fetch one page of all QB invoices (for bulk pattern matching). */
async function qbFetchInvoicePage(app: string, startPosition: number): Promise<QbInvoice[]> {
  const rows = await qbQuery(
    app,
    `SELECT Id, DocNumber FROM Invoice ORDERBY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS 1000`
  );
  if (!rows) return [];
  return rows.map((r: any) => ({ id: String(r.Id), docNumber: r.DocNumber ? String(r.DocNumber) : null }));
}

/** Extract last 6 numeric digits from an enrolment ID — mirrors buildTmsInvoiceNo logic. */
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

/**
 * POST /api/finance/invoice-jobs/backfill-from-qb
 *
 * Three-pass backfill to link QB invoice IDs to enrolments:
 *
 * Pass 1 (local, instant): invoice_jobs rows that already have qbo_invoice_id but status != 'done'
 *   → mark done. Covers jobs that succeeded in QB but failed in later steps (PDF, Drive).
 *
 * Pass 2 (DocNumber lookup): invoice_jobs rows with invoice_no but no qbo_invoice_id
 *   → search QB by DocNumber IN (...) — DocNumber IS a filterable field in QBO.
 *
 * Pass 3 (bulk scan): enrolments still missing a done invoice_jobs entry
 *   → fetch all QB invoices, match by the last-6-digits suffix in DocNumber (TC26-0315-{last6}).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureInvoiceJobsTable();

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
    const apps: string[] = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

    // ── Pass 1: local fix (no QB call) ────────────────────────────────────────
    const p1 = await pool.query(
      `UPDATE public.invoice_jobs
       SET status = 'done', updated_at = now()
       WHERE status != 'done'
         AND qbo_invoice_id IS NOT NULL
       RETURNING enrolment_id`
    );
    const localFixed = p1.rowCount ?? 0;

    // ── Pass 2: DocNumber lookup for jobs that have invoice_no but no qbo_invoice_id ──
    const failedWithNo = await pool.query(
      `SELECT id::text AS id, enrolment_id::text AS enrolment_id, invoice_no::text AS invoice_no
       FROM public.invoice_jobs
       WHERE status != 'done'
         AND invoice_no IS NOT NULL
         AND qbo_invoice_id IS NULL`
    );
    const pass2Rows = failedWithNo.rows as Array<{ id: string; enrolment_id: string; invoice_no: string }>;
    let pass2Resolved = 0;

    if (pass2Rows.length > 0) {
      const docNumbers = pass2Rows.map((r) => r.invoice_no);
      const byDocNumber = new Map<string, string>(); // docNumber → qbo invoice id

      for (const app of apps) {
        const found = await qbFindByDocNumbers(app, docNumbers);
        for (const inv of found) {
          if (inv.docNumber && !byDocNumber.has(inv.docNumber)) {
            byDocNumber.set(inv.docNumber, inv.id);
          }
        }
      }

      for (const row of pass2Rows) {
        const qboId = byDocNumber.get(row.invoice_no);
        if (!qboId) continue;
        await pool.query(
          `UPDATE public.invoice_jobs
           SET qbo_invoice_id = $2::varchar, status = 'done', updated_at = now()
           WHERE id = $1::uuid`,
          [row.id, qboId]
        );
        pass2Resolved++;
      }
    }

    // ── Pass 3: bulk QB scan — match by last-6 suffix in DocNumber ────────────
    // Find enrolments still missing a done invoice entry
    const missingRes = await pool.query(
      `SELECT se.enrolment_id::text AS enrolment_id,
              COALESCE(e.user_id::text, '')    AS user_id,
              COALESCE(u.email::text, '')      AS learner_email,
              COALESCE(e.course_reference::text, '') AS course_code
       FROM ssg_enrolments se
       LEFT JOIN enrollment e
         ON LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
       LEFT JOIN app_user u ON u.id = e.user_id
       WHERE se.enrolment_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.invoice_jobs ij
           WHERE LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
             AND ij.status = 'done'
             AND ij.qbo_invoice_id IS NOT NULL
         )
       ORDER BY se.enrolment_id`
    );

    const missingRows = missingRes.rows as Array<{
      enrolment_id: string;
      user_id: string;
      learner_email: string;
      course_code: string;
    }>;
    let pass3Resolved = 0;

    if (missingRows.length > 0) {
      // Build lookup: last6 → [enrolmentId, ...] (may have collisions but rare)
      const last6Map = new Map<string, string[]>();
      for (const row of missingRows) {
        const l6 = enrolmentLast6(row.enrolment_id);
        if (!l6) continue;
        const existing = last6Map.get(l6) ?? [];
        existing.push(row.enrolment_id);
        last6Map.set(l6, existing);
      }

      if (last6Map.size > 0) {
        // Fetch all QB invoices across both apps, paginated
        const allQbInvoices = new Map<string, QbInvoice>(); // docNumber → invoice

        for (const app of apps) {
          let startPos = 1;
          while (true) {
            const page = await qbFetchInvoicePage(app, startPos);
            if (!page || page.length === 0) break;
            for (const inv of page) {
              if (inv.docNumber && !allQbInvoices.has(inv.docNumber)) {
                allQbInvoices.set(inv.docNumber, inv);
              }
            }
            if (page.length < 1000) break; // last page
            startPos += 1000;
          }
        }

        // Match QB invoices to missing enrolments by last-6 suffix
        // DocNumber format: TC{yy}-{mmdd}-{last6}  — last 6 chars of DocNumber = last6
        // Only TC-format DocNumbers are eligible: GRN-/SFC- supplemental invoices share
        // the enrolment suffix and would otherwise be misattributed as customer invoices.
        const enrolmentByLast6 = new Map<string, string>(); // last6 → enrolment_id (unique matches only)
        for (const [l6, enrolmentIds] of last6Map.entries()) {
          if (enrolmentIds.length === 1) {
            enrolmentByLast6.set(l6, enrolmentIds[0]);
          }
          // skip if multiple enrolments share the same last6 (collision) — too ambiguous
        }

        for (const [docNumber, inv] of allQbInvoices.entries()) {
          if (!isCustomerInvoiceDocNumber(docNumber)) continue;
          const suffix = docNumber.slice(-6);
          const enrolmentId = enrolmentByLast6.get(suffix);
          if (!enrolmentId) continue;

          const enrRow = missingRows.find((r) => r.enrolment_id === enrolmentId);
          if (!enrRow) continue;

          try {
            const userId = enrRow.user_id || null;
            if (userId) {
              await pool.query(
                `INSERT INTO public.invoice_jobs
                   (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id, qbo_doc_number)
                 VALUES ($1::text, $2::uuid, $3::text, $4::text, 'done', $5::varchar, $6::varchar)
                 ON CONFLICT (enrolment_id) DO UPDATE SET
                   qbo_invoice_id  = EXCLUDED.qbo_invoice_id,
                   qbo_doc_number  = EXCLUDED.qbo_doc_number,
                   status          = 'done',
                   updated_at      = now()`,
                [enrolmentId, userId, enrRow.learner_email || '', enrRow.course_code || '', inv.id, docNumber]
              );
            } else {
              await pool.query(
                `INSERT INTO public.invoice_jobs
                   (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id, qbo_doc_number)
                 VALUES ($1::text, gen_random_uuid(), '', '', 'done', $2::varchar, $3::varchar)
                 ON CONFLICT (enrolment_id) DO UPDATE SET
                   qbo_invoice_id  = EXCLUDED.qbo_invoice_id,
                   qbo_doc_number  = EXCLUDED.qbo_doc_number,
                   status          = 'done',
                   updated_at      = now()`,
                [enrolmentId, inv.id, docNumber]
              );
            }
            pass3Resolved++;
          } catch (e) {
            console.error('[backfill-from-qb] pass3 upsert error:', e instanceof Error ? e.message : e);
          }
        }
      }
    }

    const total = localFixed + pass2Resolved + pass3Resolved;

    return res.status(200).json({
      success: true,
      data: { localFixed, pass2Resolved, pass3Resolved, total },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}
