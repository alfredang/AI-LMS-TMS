import * as XLSX from 'xlsx';
import pool from '@/lib/db';
import {
  requireSfcImportSchema,
  insertSfcImportRow,
  updateSfcImportBatchCounts,
  listAlreadyAppliedSfcClaimIds,
  getAppliedQbPaymentIdsByClaimId,
} from './sfcImportDb';

type ProxyResponse<T = any> = { success: boolean; data?: T; error?: string };

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

async function callQbProxy(body: Record<string, any>): Promise<any> {
  const baseUrl =
    process.env.QBO_PROXY_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000';
  const resp = await fetch(`${baseUrl}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => null)) as ProxyResponse | null;
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `QB proxy returned ${resp.status}`);
  }
  return data.data;
}

function parseDisbursementDate(raw: string): string | null {
  // Input: DD/MM/YYYY → Output: YYYY-MM-DD
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseSfcXlsx(filepath: string): Array<Record<string, any>> {
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: Array<Record<string, any>> = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return raw;
}

const COL = {
  claimId: 'Claim Id',
  individualNric: 'Individual NRIC',
  individualName: 'Individual Name',
  courseRefNumber: 'Course Reference Number',
  courseName: 'Course Name',
  courseStartDate: 'Course Start Date',
  disbursementDate: 'Disbursement Date',
  claimAmount: 'Claim Amount',
  payoutRequestId: 'Payout Request ID',
  claimStatus: 'Claim Status',
};


async function qbGetInvoiceById(app: string, invoiceId: string): Promise<{ balance: number; customerRef: string } | null> {
  try {
    const data = await callQbProxy({ action: 'read', entity: 'invoice', id: invoiceId, app });
    const inv = data?.Invoice ?? data;
    if (!inv?.Id) return null;
    const balance = Number(inv.Balance ?? 0);
    const customerRef = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '';
    return { balance, customerRef };
  } catch {
    return null;
  }
}

async function qbFindInvoiceByEnrolmentId(apps: string[], enrolmentId: string): Promise<{
  app: string;
  id: string;
  balance: number;
  customerRef: string;
  docNumber: string | null;
} | null> {
  const safe = String(enrolmentId || '').replace(/'/g, "''").trim();
  if (!safe) return null;
  for (const app of apps) {
    try {
      const data = await callQbProxy({
        action: 'query',
        entity: 'invoice',
        app,
        query: `SELECT * FROM Invoice WHERE PrivateNote = 'SSG enrolment: ${safe}' MAXRESULTS 5`,
      });
      const rows = data?.QueryResponse?.Invoice;
      const list: any[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
      if (list.length > 0) {
        // Prefer the customer invoice (TC26-...) over the GRN invoice (GRN-...) — both share
        // the same PrivateNote so the QB query can return either. Within each group, prefer
        // positive balance (outstanding) over zero (already paid).
        const isTc = (x: any) => String(x?.DocNumber || '').toUpperCase().startsWith('TC');
        const hasBalance = (x: any) => Number(x?.Balance ?? 0) > 0;
        const inv =
          list.find((x: any) => isTc(x) && hasBalance(x)) ??
          list.find((x: any) => isTc(x)) ??
          list.find((x: any) => hasBalance(x)) ??
          list[0];
        if (inv?.Id) {
          return {
            app,
            id: String(inv.Id),
            balance: Number(inv.Balance ?? 0),
            customerRef: inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '',
            docNumber: inv?.DocNumber ? String(inv.DocNumber) : null,
          };
        }
      }
    } catch {
      // Try next app
    }
  }
  return null;
}

async function qbFindInvoiceByDocNumber(apps: string[], docNumber: string): Promise<{
  app: string;
  id: string;
  balance: number;
  customerRef: string;
  docNumber: string | null;
} | null> {
  const safeDoc = escapeQbQueryString(String(docNumber || '').trim());
  if (!safeDoc) return null;
  for (const app of apps) {
    try {
      const data = await callQbProxy({
        action: 'query',
        entity: 'invoice',
        app,
        query: `SELECT Id, DocNumber, Balance, CustomerRef FROM Invoice WHERE DocNumber = '${safeDoc}' MAXRESULTS 5`,
      });
      const rows = data?.QueryResponse?.Invoice;
      const list: any[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
      const inv = list[0];
      if (inv?.Id) {
        return {
          app,
          id: String(inv.Id),
          balance: Number(inv.Balance ?? 0),
          customerRef: inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '',
          docNumber: inv?.DocNumber ? String(inv.DocNumber) : null,
        };
      }
    } catch {
      // Try next app
    }
  }
  return null;
}

export async function sfcStage1ParseMatchAndPersist(input: {
  filepath: string;
  filename: string | null;
  batchId: number;
  actorUserId: string | null;
  onProgress?: (p: { pct: number; message: string }) => void;
}): Promise<void> {
  await requireSfcImportSchema();

  input.onProgress?.({ pct: 3, message: 'Parsing Excel' });
  const rawRows = parseSfcXlsx(input.filepath);

  // Only process "Paid" rows
  const paidRows = rawRows.filter((r) => String(r[COL.claimStatus] || '').trim() === 'Paid');

  input.onProgress?.({ pct: 10, message: `Found ${paidRows.length} Paid rows` });

  const claimIdsAll = paidRows
    .map((r) => String(r[COL.claimId] || '').trim())
    .filter(Boolean);
  const claimIdsUnique = Array.from(new Set(claimIdsAll));

  const [alreadyAppliedSet, appliedQbPaymentIds] = await Promise.all([
    listAlreadyAppliedSfcClaimIds(claimIdsUnique),
    getAppliedQbPaymentIdsByClaimId(claimIdsUnique),
  ]);

  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || 'app1').trim() || 'app1';
  const runQbChecks = paidRows.length <= 120;

  const totalRows = paidRows.length;
  const counts = {
    total_rows: totalRows,
    ready_count: 0,
    already_applied_count: 0,
    unmatched_count: 0,
    skipped_da_count: 0,
    invalid_count: 0,
  };

  for (let i = 0; i < paidRows.length; i++) {
    const raw = paidRows[i];
    const rowIndex = i;

    if ((i + 1) % 10 === 0 || i === paidRows.length - 1) {
      const pct = 10 + Math.round(((i + 1) / Math.max(1, totalRows)) * 75);
      input.onProgress?.({ pct, message: `Processing rows (${i + 1}/${totalRows})` });
    }

    const claimId = String(raw[COL.claimId] || '').trim();
    const individualNric = String(raw[COL.individualNric] || '').trim();
    const individualName = String(raw[COL.individualName] || '').trim();
    const courseRefNumber = String(raw[COL.courseRefNumber] || '').trim();
    const courseName = String(raw[COL.courseName] || '').trim();
    const courseStartDate = String(raw[COL.courseStartDate] || '').trim();
    const disbursementDateRaw = String(raw[COL.disbursementDate] || '').trim();
    const disbursementDateIso = parseDisbursementDate(disbursementDateRaw);
    const claimAmountRaw = raw[COL.claimAmount];
    const claimAmount = claimAmountRaw !== '' ? parseFloat(String(claimAmountRaw)) : NaN;
    const payoutRequestId = String(raw[COL.payoutRequestId] || '').trim();
    const claimStatus = String(raw[COL.claimStatus] || '').trim();

    const validationErrors: string[] = [];
    if (!claimId) validationErrors.push('Missing Claim Id');
    if (!individualNric) validationErrors.push('Missing Individual NRIC');
    if (!Number.isFinite(claimAmount) || claimAmount <= 0) validationErrors.push('Claim Amount must be a positive number');
    if (!disbursementDateRaw) validationErrors.push('Missing Disbursement Date');
    else if (!disbursementDateIso) validationErrors.push('Disbursement Date is not in DD/MM/YYYY format');
    if (!payoutRequestId) validationErrors.push('Missing Payout Request ID');

    const baseFields = {
      batch_id: input.batchId,
      row_index: rowIndex,
      claim_id: claimId || null,
      individual_nric: individualNric || null,
      individual_name: individualName || null,
      course_reference_number: courseRefNumber || null,
      course_name: courseName || null,
      course_start_date: courseStartDate || null,
      disbursement_date: disbursementDateRaw || null,
      disbursement_date_iso: disbursementDateIso,
      claim_amount: Number.isFinite(claimAmount) ? claimAmount : null,
      payout_request_id: payoutRequestId || null,
      claim_status: claimStatus || null,
    };

    // Step 1 — Validate
    if (validationErrors.length > 0) {
      counts.invalid_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'invalid',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: validationErrors,
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    // Step 2 — Match to ssg_claims
    // Note: ssg_claims uses enrollment_id (American spelling); ssg_enrolments uses enrolment_id (British)
    const matches = await pool.query(
      `SELECT
         sc.id::text AS ssg_claim_row_id,
         sc.claim_id,
         sc.claim_amount AS fms_claim_amount,
         sc.claim_status AS fms_claim_status,
         sc.claim_payment_status,
         sc.qb_payment_id AS existing_qb_payment_id,
         se.enrolment_id,
         se.sponsorship_type,
         se.trainee_nric,
         se.trainee_name,
         ij.qbo_invoice_id,
         ij.qbo_doc_number,
         ij.invoice_no,
         da.invoice_id AS da_invoice_id,
         da.application_id AS da_application_id,
         da.sfc_invoice_id AS da_sfc_invoice_id
       FROM public.ssg_claims sc
       JOIN public.ssg_enrolments se ON sc.enrollment_id = se.enrolment_id
       LEFT JOIN public.invoice_jobs ij ON ij.enrolment_id = se.enrolment_id
       LEFT JOIN public.da_application da ON LOWER(TRIM(COALESCE(da.enrolment_id,''))) = LOWER(TRIM(COALESCE(se.enrolment_id,'')))
       WHERE sc.claim_id = $1`,
      [claimId]
    );

    if (matches.rows.length === 0) {
      counts.unmatched_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'unmatched',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: ['Claim ID not found in FMS'],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    if (matches.rows.length > 1) {
      counts.unmatched_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'unmatched',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: ['Claim ID matches multiple records'],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    const match = matches.rows[0];
    const enrolmentId = String(match.enrolment_id || '');
    const sponsorshipType = String(match.sponsorship_type || '');
    const ssgClaimRowId = String(match.ssg_claim_row_id || '');
    const daApplicationId = match.da_application_id ? String(match.da_application_id) : null;
    const daSfcInvoiceId = match.da_sfc_invoice_id ? String(match.da_sfc_invoice_id) : null;
    const isDa = !!(daApplicationId && String(daApplicationId).trim());

    // Main (TC / net-fee) invoice reference
    const mainInvoiceId = match.qbo_invoice_id
      ? String(match.qbo_invoice_id)
      : match.da_invoice_id
        ? String(match.da_invoice_id)
        : null;
    const mainDocNumber = match.qbo_doc_number
      ? String(match.qbo_doc_number)
      : match.invoice_no
        ? String(match.invoice_no)
        : null;

    // Target invoice for SFC payment apply:
    // - Non-DA: main invoice
    // - DA: supplemental SFC invoice (DocNumber SFC-CA-...), created later if missing
    let qboInvoiceId = isDa ? (daSfcInvoiceId ? String(daSfcInvoiceId) : null) : mainInvoiceId;
    // For DA rows, derive the SFC invoice doc number from the application ID (SFC-{appId}) when the
    // invoice ID is already stored — this avoids a QB API call on every re-upload while still
    // showing the invoice number in the preview. On first upload (no stored ID) the QB search
    // below fills this in from the live result.
    let qboDocNumber = isDa
      ? (daSfcInvoiceId && daApplicationId ? `SFC-${String(daApplicationId).trim().toUpperCase()}` : null)
      : (mainDocNumber ? String(mainDocNumber) : null);

    // DA rows: if we don't have the supplemental invoice id stored yet, try to find the existing SFC-CA invoice in QB
    // so the preview can correctly show "QB paid" (balance=0) without requiring an FMS apply.
    if (isDa && !qboInvoiceId && daApplicationId) {
      const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      const desiredDocNumber = `SFC-${String(daApplicationId).trim().toUpperCase()}`;
      const found = await qbFindInvoiceByDocNumber(apps, desiredDocNumber);
      if (found?.id) {
        qboInvoiceId = found.id;
        qboDocNumber = found.docNumber;
        // Best-effort backfill so next run resolves from DB
        try {
          await pool.query(
            `UPDATE public.da_application
             SET sfc_invoice_id = $2::varchar
             WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))`,
            [enrolmentId, found.id]
          );
        } catch {
          // best-effort
        }
      }
    }

    // Step 3 — Already applied check (DB)
    // sfc_import_rows tracked payment ID (from a previous apply run via this tool)
    const sfcTrackedPaymentId = appliedQbPaymentIds.get(claimId) ?? null;
    // ssg_claims.qb_payment_id is the source-of-truth: set by the apply step when a QB payment is created
    const ssgClaimsPaymentId = match.existing_qb_payment_id ? String(match.existing_qb_payment_id) : null;
    const storedQbPaymentId = sfcTrackedPaymentId ?? ssgClaimsPaymentId;
    if (alreadyAppliedSet.has(claimId) || storedQbPaymentId) {
      counts.already_applied_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'already_applied',
        matched_enrolment_id: enrolmentId,
        matched_ssg_claim_id: ssgClaimRowId,
        sponsorship_type: sponsorshipType,
        da_application_id: daApplicationId,
        da_sfc_invoice_id: daSfcInvoiceId,
        main_qbo_invoice_id: mainInvoiceId,
        main_qbo_doc_number: mainDocNumber,
        matched_qbo_invoice_id: qboInvoiceId,
        matched_qbo_doc_number: qboDocNumber,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: storedQbPaymentId,
        validation_errors: [],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    // Step 5 — Find QB invoice (main invoice only): DB first, then QB fallback
    // DA enrolments: use da_application.invoice_id before hitting QB API (main TC/net-fee invoice)
    if (!mainInvoiceId && match.da_invoice_id) {
      const candidate = String(match.da_invoice_id);
      // Only backfill main invoice fields; DA SFC invoice is handled separately in apply.
      const resolvedMainInvoiceId = candidate;
      // For non-DA rows, we also use this as the target qboInvoiceId.
      if (!isDa && !qboInvoiceId) qboInvoiceId = resolvedMainInvoiceId;
      if (!mainDocNumber && match.invoice_no) qboDocNumber = String(match.invoice_no);

      // Backfill invoice_jobs so next upload resolves from DB (best-effort)
      try {
        await pool.query(
          `INSERT INTO public.invoice_jobs (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id)
           SELECT $1::text, e.user_id, COALESCE(e.email, ''), COALESCE(e.course_reference, ''), 'done', $2::varchar
           FROM public.enrollment e
           WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($1::text))
           LIMIT 1
           ON CONFLICT (enrolment_id) DO UPDATE SET
             qbo_invoice_id = EXCLUDED.qbo_invoice_id,
             status = 'done',
             updated_at = now()
           WHERE public.invoice_jobs.qbo_invoice_id IS NULL`,
          [enrolmentId, candidate]
        );
      } catch {
        // best-effort backfill — proceed regardless
      }
    }

    if (!qboInvoiceId && !isDa) {
      if ((i + 1) % 10 === 0 || i === paidRows.length - 1) {
        input.onProgress?.({ pct: 10 + Math.round(((i + 1) / Math.max(1, totalRows)) * 75), message: `Searching QuickBooks for invoice (${i + 1}/${totalRows})…` });
      }
      const searchApps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      const found = await qbFindInvoiceByEnrolmentId(searchApps, enrolmentId);
      if (found) {
        qboInvoiceId = found.id;
        qboDocNumber = found.docNumber;
        // Backfill invoice_jobs so the next upload resolves from DB (best-effort)
        try {
          await pool.query(
            `INSERT INTO public.invoice_jobs (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id, qbo_doc_number)
             SELECT $1::text, e.user_id, COALESCE(e.email, ''), COALESCE(e.course_reference, ''), 'done', $2::varchar, $3::varchar
             FROM public.enrollment e
             WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($1::text))
             LIMIT 1
             ON CONFLICT (enrolment_id) DO UPDATE SET
               qbo_invoice_id = EXCLUDED.qbo_invoice_id,
               qbo_doc_number = EXCLUDED.qbo_doc_number,
               status = 'done',
               updated_at = now()
             WHERE public.invoice_jobs.qbo_invoice_id IS NULL`,
            [enrolmentId, found.id, found.docNumber]
          );
        } catch {
          // backfill is best-effort — proceed regardless
        }
      } else {
        counts.unmatched_count++;
        await insertSfcImportRow({
          ...baseFields,
          match_status: 'unmatched',
          matched_enrolment_id: enrolmentId,
          matched_ssg_claim_id: ssgClaimRowId,
          sponsorship_type: sponsorshipType,
          da_application_id: daApplicationId,
          da_sfc_invoice_id: daSfcInvoiceId,
          main_qbo_invoice_id: mainInvoiceId,
          main_qbo_doc_number: mainDocNumber,
          matched_qbo_invoice_id: null,
          matched_qbo_doc_number: null,
          matched_qbo_invoice_balance: null,
          matched_qb_payment_id: null,
          validation_errors: ['No QB invoice found for this enrolment in database or QuickBooks'],
          apply_status: null,
          apply_error: null,
        });
        continue;
      }
    }

    let qboInvoiceBalance: number | null = null;
    let resolvedMatchStatus = 'ready';

    // DA rows can be "ready" even before the supplemental SFC invoice exists.
    // In that case, Stage 2 will create the invoice (DocNumber SFC-CA-...) and then apply payment.
    if (runQbChecks && qboInvoiceId) {
      const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      for (const app of apps) {
        const invData = await qbGetInvoiceById(app, qboInvoiceId);
        if (invData !== null) {
          qboInvoiceBalance = invData.balance;
          if (invData.balance === 0) {
            resolvedMatchStatus = 'already_applied';
          }
          break;
        }
      }
    }

    if (resolvedMatchStatus === 'already_applied') {
      counts.already_applied_count++;
    } else {
      counts.ready_count++;
    }

    await insertSfcImportRow({
      ...baseFields,
      match_status: resolvedMatchStatus,
      matched_enrolment_id: enrolmentId,
      matched_ssg_claim_id: ssgClaimRowId,
      sponsorship_type: sponsorshipType,
      da_application_id: daApplicationId,
      da_sfc_invoice_id: daSfcInvoiceId,
      main_qbo_invoice_id: mainInvoiceId,
      main_qbo_doc_number: mainDocNumber,
      matched_qbo_invoice_id: qboInvoiceId,
      matched_qbo_doc_number: qboDocNumber,
      matched_qbo_invoice_balance: qboInvoiceBalance,
      matched_qb_payment_id: null,
      validation_errors: [],
      apply_status: null,
      apply_error: null,
    });
  }

  input.onProgress?.({ pct: 92, message: 'Saving batch summary' });
  await updateSfcImportBatchCounts(input.batchId, counts, 'completed');
  input.onProgress?.({ pct: 100, message: 'Done' });
}
