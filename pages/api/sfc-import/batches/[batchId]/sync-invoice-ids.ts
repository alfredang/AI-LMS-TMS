import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { requireSfcImportSchema } from '@/lib/services/sfcImport/sfcImportDb';
import { callQbProxy } from '@/lib/quickbooks/qbProxyClient';
import { verifySfcInvoiceMatch } from '@/lib/services/sfcImport/sfcInvoiceVerify';
import { realApplicationId } from '@/lib/daApplicationId';

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Same DD-MM-YYYY / YYYYMMDD -> YYYY-MM-DD normalization used in sfcImportStage1.ts / all-course-runs.ts. */
const RUN_START_NORM_SQL = `(
  CASE
    WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{8}$' THEN
      substr((se.raw_data->'course'->'run'->>'startDate'), 1, 4) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 5, 2) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 7, 2)
    WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
      substr((se.raw_data->'course'->'run'->>'startDate'), 7, 4) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 4, 2) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 1, 2)
    ELSE NULLIF(trim(se.raw_data->'course'->'run'->>'startDate'), '')
  END
)`;

async function qbReadInvoiceFull(app: string, invoiceId: string): Promise<{ docNumber: string | null; raw: any } | null> {
  try {
    const resp = await callQbProxy({ action: 'read', entity: 'invoice', id: invoiceId, app });
    const inv = resp?.data?.Invoice ?? resp?.data;
    if (!inv?.Id) return null;
    return { docNumber: inv?.DocNumber ? String(inv.DocNumber) : null, raw: inv };
  } catch {
    return null;
  }
}

async function qbFindInvoiceByDocNumber(apps: string[], docNumber: string): Promise<{ app: string; id: string; docNumber: string } | null> {
  const safe = escapeQbQueryString(String(docNumber || '').trim());
  if (!safe) return null;
  for (const app of apps) {
    try {
      const resp = await callQbProxy({ action: 'query', entity: 'invoice', app, query: `SELECT Id, DocNumber FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1` });
      const rows = resp?.data?.QueryResponse?.Invoice;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.Id) return { app, id: String(row.Id), docNumber: row.DocNumber ? String(row.DocNumber) : docNumber };
    } catch {
      // try next app
    }
  }
  return null;
}

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

/** Writes a resolved (verified) invoice link to both invoice_jobs and the sfc_import_rows row. */
async function linkResolvedInvoice(
  batchId: number,
  row: { id: number; matched_enrolment_id: string },
  qboInvoiceId: string,
  qboDocNumber: string | null
): Promise<void> {
  const enrolmentId = String(row.matched_enrolment_id || '').trim();
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
  // Every caller here only ever resolves a "TC..." customer invoice (Step 4/5's last-6 scan and
  // Stage 2's blind scan are both scoped to TC-prefixed DocNumbers), so it's also the verified
  // "Customer Invoice No" reference — stamped into main_qbo_* so it survives independently of
  // whatever matched_qbo_* later becomes (e.g. once a DA row's SFC-CA invoice gets generated,
  // which overwrites matched_qbo_* but must never overwrite this).
  await pool.query(
    `UPDATE public.sfc_import_rows SET
       matched_qbo_invoice_id = $2::varchar,
       matched_qbo_doc_number = $3::varchar,
       main_qbo_invoice_id = $2::varchar,
       main_qbo_doc_number = $3::varchar,
       match_status = 'ready',
       apply_status = NULL,
       apply_error = NULL
     WHERE id = $1::int AND batch_id = $4::int`,
    [row.id, qboInvoiceId, qboDocNumber, batchId]
  );
}

async function qbFetchAllInvoices(app: string): Promise<Array<{ id: string; docNumber: string | null }>> {
  const all: Array<{ id: string; docNumber: string | null }> = [];
  let startPos = 1;
  while (true) {
    try {
      const resp = await callQbProxy({
        action: 'query',
        entity: 'invoice',
        app,
        query: `SELECT Id, DocNumber FROM Invoice ORDERBY TxnDate DESC STARTPOSITION ${startPos} MAXRESULTS 1000`,
      });
      const rows = resp?.data?.QueryResponse?.Invoice;
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // All unmatched rows that have an enrolment_id but no QB invoice yet — joined against
    // da_application so we know, BEFORE searching QuickBooks, whether this claim's SFC payment
    // target should be the supplemental SFC invoice (DA) or the main Customer invoice (non-DA).
    // Getting this branch wrong is exactly how a DA row's payment could end up pointed at the
    // wrong invoice TYPE even when NRIC/course content genuinely matches the learner.
    const r = await pool.query(
      `SELECT sr.id, sr.matched_enrolment_id, sr.individual_nric, sr.course_reference_number,
              da.application_id AS da_application_id,
              NULLIF(TRIM(se.course_run_id::text), '') AS course_run_id,
              ${RUN_START_NORM_SQL} AS course_start_date_iso
       FROM public.sfc_import_rows sr
       LEFT JOIN public.da_application da
         ON LOWER(TRIM(COALESCE(da.enrolment_id,''))) = LOWER(TRIM(COALESCE(sr.matched_enrolment_id,'')))
       LEFT JOIN public.ssg_enrolments se
         ON LOWER(TRIM(COALESCE(se.enrolment_id,''))) = LOWER(TRIM(COALESCE(sr.matched_enrolment_id,'')))
       WHERE sr.batch_id = $1::int
         AND sr.match_status = 'unmatched'
         AND sr.matched_enrolment_id IS NOT NULL
         AND sr.matched_qbo_invoice_id IS NULL
       ORDER BY sr.row_index ASC`,
      [batchId]
    );

    const allUnmatchedRows = r.rows as Array<{
      id: number;
      matched_enrolment_id: string;
      individual_nric: string | null;
      course_reference_number: string | null;
      da_application_id: string | null;
      course_run_id: string | null;
      course_start_date_iso: string | null;
    }>;
    const total = allUnmatchedRows.length;

    if (total === 0) {
      return res.status(200).json({ success: true, data: { resolved: 0, notFound: 0, rejected: 0, errors: 0, total: 0 } });
    }

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
    const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

    let resolved = 0;
    let notFound = 0;
    let rejected = 0;
    let errors = 0;
    const warnings: string[] = [];

    // Split by DA status — a real (non-placeholder) MySkillsFuture application_id normally means
    // the SFC payment should target the SFC-CA supplemental invoice, never the Customer (TC)
    // invoice. But when that automated invoice creation fails (confirmed live: QuickBooks
    // rejecting it with "Account Period Closed, Cannot Update Through Services API"), staff raise
    // a substitute by hand — and it comes out as a normal TC customer invoice, not an SFC-CA one.
    // A DA row whose dedicated SFC-CA search fails is NOT given up on: it falls through to the
    // same TC-invoice search (Stage 2 below) that non-DA rows use, via stage2Candidates.
    const daRows = allUnmatchedRows.filter((row) => !!realApplicationId(row.da_application_id));
    const nonDaRows = allUnmatchedRows.filter((row) => !realApplicationId(row.da_application_id));
    const stage2Candidates: typeof allUnmatchedRows = [];

    // ---------- DA rows: resolve the exact SFC-CA invoice by its known DocNumber ----------
    for (const row of daRows) {
      try {
        const enrolmentId = String(row.matched_enrolment_id || '').trim();
        const appId = realApplicationId(row.da_application_id);
        if (!enrolmentId || !appId) { errors++; continue; }

        const desiredDoc = `SFC-${appId.toUpperCase()}`;
        const found = await qbFindInvoiceByDocNumber(apps, desiredDoc);
        if (!found) {
          stage2Candidates.push(row);
          continue;
        }

        const full = await qbReadInvoiceFull(found.app, found.id);
        if (!full) {
          stage2Candidates.push(row);
          continue;
        }

        const verify = await verifySfcInvoiceMatch({
          invoiceRaw: full.raw,
          docNumber: full.docNumber || desiredDoc,
          matchedEnrolmentId: enrolmentId,
          excelNric: row.individual_nric,
          excelCourseRef: row.course_reference_number,
          daApplicationId: appId,
        });
        if (!verify.ok) {
          console.warn(`[sfc-import/sync-invoice-ids] rejected DA candidate ${desiredDoc} for enrolment ${enrolmentId}: ${verify.reason} — trying Stage 2's TC-invoice scan instead`);
          stage2Candidates.push(row);
          continue;
        }

        await pool.query(
          `UPDATE public.da_application SET sfc_invoice_id = $2::varchar
           WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))`,
          [enrolmentId, found.id]
        );
        await pool.query(
          `UPDATE public.sfc_import_rows SET
             matched_qbo_invoice_id = $2::varchar,
             matched_qbo_doc_number = $3::varchar,
             match_status = 'ready',
             apply_status = NULL,
             apply_error = NULL
           WHERE id = $1::int AND batch_id = $4::int`,
          [row.id, found.id, full.docNumber || desiredDoc, batchId]
        );
        resolved++;
      } catch (e) {
        errors++;
        console.error('[sfc-import/sync-invoice-ids] DA row error:', e instanceof Error ? e.message : e);
      }
    }

    // ---------- Non-DA rows: resolve the Customer (TC) invoice, exactly as before ----------
    if (nonDaRows.length > 0) {
      // Step 1: Fix invoice_jobs rows that already have qbo_invoice_id but wrong status
      await pool.query(
        `UPDATE public.invoice_jobs SET status = 'done', updated_at = now()
         WHERE status != 'done' AND qbo_invoice_id IS NOT NULL`
      );

      // Step 2: Build last6 → enrolment map for bulk QB scan
      const last6Map = new Map<string, string>();
      const enrolmentIdSet = new Set<string>();
      for (const row of nonDaRows) {
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
      for (const rr of alreadyDone.rows) {
        doneMap.set(String(rr.enrolment_id).toLowerCase().trim(), {
          qboInvoiceId: String(rr.qbo_invoice_id),
          qboDocNumber: rr.qbo_doc_number ? String(rr.qbo_doc_number) : null,
        });
      }

      // Step 4: Bulk-fetch all QB invoices (paginated) and match by last-6 DocNumber suffix.
      // Only TC-format customer invoices are eligible — GRN-/SFC- supplemental invoices share
      // the enrolment suffix and would otherwise be misattributed. This suffix match is only a
      // CANDIDATE — Step 5 below re-fetches each candidate's full content and requires it to
      // verify against the claim's own NRIC/course reference before it's ever accepted.
      const qbInvoiceByLast6 = new Map<string, { id: string; docNumber: string; app: string }>();
      for (const app of apps) {
        const allInvoices = await qbFetchAllInvoices(app);
        for (const inv of allInvoices) {
          if (!inv.docNumber) continue;
          if (!isCustomerInvoiceDocNumber(inv.docNumber)) continue;
          const suffix = inv.docNumber.slice(-6);
          if (last6Map.has(suffix) && !qbInvoiceByLast6.has(suffix)) {
            qbInvoiceByLast6.set(suffix, { id: inv.id, docNumber: inv.docNumber, app });
          }
        }
      }

      // Step 5: Update each non-DA row. Rows whose invoice can't be found by the last-6-digit
      // scan (Step 4 only considers standard-format DocNumbers) fall through to Stage 2 below,
      // rather than being counted as notFound immediately.
      for (const row of nonDaRows) {
        try {
          const enrolmentId = String(row.matched_enrolment_id || '').trim();
          if (!enrolmentId) { errors++; continue; }

          const done = doneMap.get(enrolmentId.toLowerCase().trim());
          let qboInvoiceId: string | null = done?.qboInvoiceId ?? null;
          let qboDocNumber: string | null = done?.qboDocNumber ?? null;
          let candidateApps: string[] = done ? apps : [];

          if (!qboInvoiceId) {
            const l6 = enrolmentLast6(enrolmentId);
            const match = l6 ? qbInvoiceByLast6.get(l6) : undefined;
            if (match) {
              qboInvoiceId = match.id;
              qboDocNumber = match.docNumber;
              candidateApps = [match.app];
            }
          }

          if (!qboInvoiceId) { stage2Candidates.push(row); continue; }

          let verifiedDoc: string | null = null;
          let verifyFailReason = '';
          for (const app of candidateApps) {
            const full = await qbReadInvoiceFull(app, qboInvoiceId);
            if (!full) continue;
            const verify = await verifySfcInvoiceMatch({
              invoiceRaw: full.raw,
              docNumber: full.docNumber || qboDocNumber,
              matchedEnrolmentId: enrolmentId,
              excelNric: row.individual_nric,
              excelCourseRef: row.course_reference_number,
              courseStartDateIso: row.course_start_date_iso,
              courseRunId: row.course_run_id,
            });
            if (verify.ok) {
              verifiedDoc = full.docNumber || qboDocNumber;
            } else {
              verifyFailReason = verify.reason;
            }
            break;
          }

          if (!verifiedDoc) {
            // The candidate we had (cached in invoice_jobs, or found by last-6-digit suffix) turned
            // out to be wrong — e.g. a stale/mismatched invoice_jobs cache entry, or a coincidental
            // suffix collision with an unrelated invoice. Don't give up on this row: Stage 2's blind
            // content scan below still gets a shot at finding the CORRECT invoice independently.
            console.warn(
              `[sfc-import/sync-invoice-ids] cached/candidate invoice ${qboDocNumber || qboInvoiceId} rejected for enrolment ${enrolmentId} (${verifyFailReason || 'invoice could not be read'}) — trying Stage 2's full-content scan instead`
            );
            stage2Candidates.push(row);
            continue;
          }

          await linkResolvedInvoice(batchId, row, qboInvoiceId, qboDocNumber);
          resolved++;
        } catch (e) {
          errors++;
          console.error('[sfc-import/sync-invoice-ids] non-DA row error:', e instanceof Error ? e.message : e);
        }
      }
    }

    // ---------- Stage 2: full-content scan for rows nothing else could resolve — non-DA rows
    // Step 4's DocNumber-pattern scan couldn't find (e.g. manually-created invoices with
    // non-standard numbering, TC26-0707-04 instead of TC26-0707-125406), AND DA rows whose
    // dedicated SFC-CA search failed (e.g. auto-invoicing rejected by QuickBooks with the account
    // period closed, so staff raised a substitute TC customer invoice by hand instead). No
    // DocNumber pattern is assumed here; every "TC..." invoice in a date window around these
    // claims' course dates is a candidate, verified strictly against NRIC + course reference +
    // course date + course run all at once (verifySfcInvoiceMatch's strict mode) before linking.
    // Only rows with both course_start_date_iso and course_run_id available run this — without
    // both, a blind scan is too weak a check to trust unsupervised.
    const stage2Runnable = stage2Candidates.filter((row) => row.course_start_date_iso && row.course_run_id);
    if (stage2Runnable.length > 0) {
      // A full unbounded "every invoice ever" fetch does not finish in reasonable time — this
      // realm has 49,000+ invoices in app1 alone (confirmed live: an Id+DocNumber-only fetch of
      // all of them takes ~85s; pulling FULL content the same way is much heavier still and
      // effectively never completes as one request). Invoices are raised close to the course
      // date (confirmed: Daniel Pang's TC26-0707-04 was dated 07/07/2026 for an 08/07/2026
      // course), so bounding the search to a window around these claims' own course dates —
      // plus filtering to "TC..." DocNumbers server-side via QBO's LIKE operator (confirmed
      // supported) — cuts this from tens of thousands of records to a few hundred.
      const courseDates = stage2Runnable
        .map((row) => row.course_start_date_iso!)
        .sort();
      const isoPlusDays = (iso: string, days: number): string => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const windowStart = isoPlusDays(courseDates[0], -90);
      const windowEnd = isoPlusDays(courseDates[courseDates.length - 1], 90);

      type FullInvoice = { id: string; docNumber: string; app: string; raw: any };
      const allTcInvoices: FullInvoice[] = [];
      for (const app of apps) {
        let startPos = 1;
        while (true) {
          let page: any[] = [];
          try {
            const resp = await callQbProxy({
              action: 'query',
              entity: 'invoice',
              app,
              query: `SELECT * FROM Invoice WHERE DocNumber LIKE 'TC%' AND TxnDate >= '${windowStart}' AND TxnDate <= '${windowEnd}' ORDERBY TxnDate DESC STARTPOSITION ${startPos} MAXRESULTS 1000`,
            });
            const rows = resp?.data?.QueryResponse?.Invoice;
            page = Array.isArray(rows) ? rows : rows ? [rows] : [];
          } catch (e) {
            warnings.push(
              `${app}: invoice search failed (${e instanceof Error ? e.message : 'unknown error'}) — invoices in ${app} were not searched this run`
            );
            break;
          }
          for (const inv of page) {
            const docNumber = inv?.DocNumber ? String(inv.DocNumber) : '';
            if (/^TC/i.test(docNumber) && inv?.Id) {
              allTcInvoices.push({ id: String(inv.Id), docNumber, app, raw: inv });
            }
          }
          if (page.length < 1000) break;
          startPos += 1000;
        }
      }

      for (const row of stage2Runnable) {
        try {
          const enrolmentId = String(row.matched_enrolment_id || '').trim();
          const matches: FullInvoice[] = [];
          for (const inv of allTcInvoices) {
            const verify = await verifySfcInvoiceMatch({
              invoiceRaw: inv.raw,
              docNumber: inv.docNumber,
              matchedEnrolmentId: enrolmentId,
              excelNric: row.individual_nric,
              excelCourseRef: row.course_reference_number,
              courseStartDateIso: row.course_start_date_iso,
              courseRunId: row.course_run_id,
            });
            if (verify.ok) matches.push(inv);
          }
          if (matches.length !== 1) {
            if (matches.length > 1) {
              console.warn(
                `[sfc-import/sync-invoice-ids] stage2 ambiguous for enrolment ${enrolmentId}: ${matches.length} invoices matched all four fields (${matches.map((m) => m.docNumber).join(', ')})`
              );
            }
            notFound++;
            continue;
          }
          await linkResolvedInvoice(batchId, row, matches[0].id, matches[0].docNumber);
          resolved++;
        } catch (e) {
          errors++;
          console.error('[sfc-import/sync-invoice-ids] stage2 row error:', e instanceof Error ? e.message : e);
        }
      }
    }
    notFound += stage2Candidates.length - stage2Runnable.length;

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

    return res.status(200).json({ success: true, data: { resolved, notFound, rejected, errors, total, warnings } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
