import type { GrantImportBatchPreview, GrantImportRowMatched } from './tpGatewayDisbursementTypes';
import { parseTpGatewayDisbursementXlsx, normalizeAndParseTpGatewayRow } from './tpGatewayDisbursementParser';
import { validateTpGatewayDisbursementRow } from './tpGatewayDisbursementValidator';
import {
  findDuplicateFtx,
  getAppliedQbPaymentIdsByGrantId,
  insertGrantImportBatch,
  insertGrantImportRows,
  listAlreadyAppliedGrantIds,
  ssgEnrolmentExistsForFallback,
  ssgGrantExistsMany,
  sumAppliedReceivedByEnrolment,
  sumExpectedByEnrolmentFromSsgGrants,
} from './grantImportDb';
import pool from '@/lib/db';
import { recalcAndPersistGrantPaymentRollups } from './grantImportRollup';

type ProxyResponse<T = any> = { success: boolean; data?: T; error?: string; details?: unknown };

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

async function callQbProxy(body: Record<string, any>): Promise<any> {
  // IMPORTANT: this runs server-side. Do not use NEXT_PUBLIC_BASE_URL here because in local dev
  // it may point to production, causing server-to-server calls to hit the wrong environment.
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

async function qbFindInvoiceByDocNumber(
  app: string | undefined,
  docNumber: string
): Promise<{ id: string; customerRef?: string } | null> {
  const safe = escapeQbQueryString(String(docNumber || '').trim());
  if (!safe) return null;
  const data = await callQbProxy({
    action: 'query',
    entity: 'invoice',
    app,
    query: `SELECT * FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1`,
  });
  const inv = data?.QueryResponse?.Invoice;
  const row = Array.isArray(inv) ? inv[0] : inv;
  if (!row?.Id) return null;
  return { id: String(row.Id), customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined };
}

async function qbFindInvoiceByLineDescriptionContains(
  app: string | undefined,
  grantId: string
): Promise<{ id: string; customerRef?: string } | null> {
  const raw = String(grantId || '').trim();
  if (!raw) return null;
  const safe = escapeQbQueryString(raw);
  try {
    const data = await callQbProxy({
      action: 'query',
      entity: 'invoice',
      app,
      // Some QBO realms reject nested line queries; best-effort only.
      query: `SELECT * FROM Invoice WHERE Line.Description LIKE '%${safe}%' MAXRESULTS 1`,
    });
    const inv = data?.QueryResponse?.Invoice;
    const row = Array.isArray(inv) ? inv[0] : inv;
    if (!row?.Id) return null;
    return { id: String(row.Id), customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined };
  } catch {
    return null;
  }
}

async function listSsgGrantIdsForEnrolment(enrolmentId: string): Promise<string[]> {
  const id = String(enrolmentId || '').trim();
  if (!id) return [];
  const r = await pool.query(
    `SELECT grant_id::text AS grant_id
     FROM public.ssg_grants
     WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))
       AND COALESCE(TRIM(COALESCE(grant_id::text, '')), '') <> ''
     ORDER BY grant_id ASC`,
    [id]
  );
  return r.rows.map((x: any) => String(x.grant_id)).filter(Boolean);
}

async function qbResolveInvoiceForGrantRow(input: {
  app: string | undefined;
  grantId: string;
  enrolmentId: string | null;
  paymentDate?: string | null;
}): Promise<
  | { id: string; customerRef?: string; resolvedBy: 'docNumber' | 'line_description' | 'enrolment_grant_docNumber' | 'enrolment_grant_line_description' }
  | null
> {
  const direct = await qbFindInvoiceByDocNumber(input.app, input.grantId);
  if (direct?.id) return { ...direct, resolvedBy: 'docNumber' };
  const byDesc = await qbFindInvoiceByLineDescriptionContains(input.app, input.grantId);
  if (byDesc?.id) return { ...byDesc, resolvedBy: 'line_description' };
  if (input.paymentDate) {
    const scanned = await qbFindInvoiceByScanningRecentInvoices(input.app, input.grantId, input.paymentDate);
    if (scanned?.id) return { ...scanned, resolvedBy: 'line_description' };
  }
  if (input.enrolmentId) {
    const grns = await listSsgGrantIdsForEnrolment(input.enrolmentId);
    for (const grn of grns) {
      const hit = await qbFindInvoiceByDocNumber(input.app, grn);
      if (hit?.id) return { ...hit, resolvedBy: 'enrolment_grant_docNumber' };
      const hitDesc = await qbFindInvoiceByLineDescriptionContains(input.app, grn);
      if (hitDesc?.id) return { ...hitDesc, resolvedBy: 'enrolment_grant_line_description' };
      if (input.paymentDate) {
        const scanned2 = await qbFindInvoiceByScanningRecentInvoices(input.app, grn, input.paymentDate);
        if (scanned2?.id) return { ...scanned2, resolvedBy: 'enrolment_grant_line_description' };
      }
    }
  }
  return null;
}

function toLineArray(lines: any): any[] {
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

function parseIsoDate(s: string): Date | null {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmtIsoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function invoiceHasGrantInDescription(inv: any, grantId: string): boolean {
  const g = String(grantId || '').trim();
  if (!g) return false;
  const lines = toLineArray(inv?.Line);
  return lines.some((ln: any) => String(ln?.Description || '').includes(g));
}

async function qbFindInvoiceByScanningRecentInvoices(
  app: string | undefined,
  grantId: string,
  paymentDate: string
): Promise<{ id: string; customerRef?: string } | null> {
  const d = parseIsoDate(paymentDate);
  if (!d) return null;
  const end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(d.getTime() - 180 * 24 * 60 * 60 * 1000);
  const endIso = fmtIsoDate(end);
  const startIso = fmtIsoDate(start);

  const pageSize = 100;
  const maxPages = 15;
  for (let page = 0; page < maxPages; page++) {
    const startPos = page * pageSize + 1;
    const data = await callQbProxy({
      action: 'query',
      entity: 'invoice',
      app,
      query: `SELECT * FROM Invoice WHERE TxnDate >= '${startIso}' AND TxnDate <= '${endIso}' STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`,
    });
    const rows = data?.QueryResponse?.Invoice;
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (arr.length === 0) return null;
    const hit = arr.find((inv: any) => invoiceHasGrantInDescription(inv, grantId));
    if (hit?.Id) return { id: String(hit.Id), customerRef: hit?.CustomerRef?.value ? String(hit.CustomerRef.value) : undefined };
    if (arr.length < pageSize) return null;
  }
  return null;
}

async function qbQueryPaymentsByCustomerAndDate(app: string | undefined, customerRef: string, txnDate: string): Promise<any[]> {
  const safeCust = escapeQbQueryString(String(customerRef || '').trim());
  const safeDate = escapeQbQueryString(String(txnDate || '').trim());
  if (!safeCust || !safeDate) return [];
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE CustomerRef = '${safeCust}' AND TxnDate = '${safeDate}' MAXRESULTS 200`,
  });
  const rows = data?.QueryResponse?.Payment;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

function paymentLinksInvoiceAndAmount(p: any, invoiceId: string, amount: number): boolean {
  const arr = toLineArray(p?.Line);
  for (const ln of arr) {
    const larr = toLineArray(ln?.LinkedTxn);
    const hasLink = larr.some((x: any) => String(x?.TxnType || '') === 'Invoice' && String(x?.TxnId || '') === String(invoiceId));
    if (!hasLink) continue;
    const a = Number(ln?.Amount);
    if (Number.isFinite(a) && Math.abs(a - amount) < 0.01) return true;
  }
  return false;
}
async function qbQueryPaymentByRefNum(app: string | undefined, paymentRefNum: string): Promise<any | null> {
  const safe = escapeQbQueryString(String(paymentRefNum || '').trim());
  if (!safe) return null;
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE PaymentRefNum = '${safe}' MAXRESULTS 1`,
  });
  const rows = data?.QueryResponse?.Payment;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row?.Id ? row : null;
}

export async function stage1UploadParseValidateMatchAndPersist(input: {
  filepath: string;
  filename: string | null;
  actorUserId: string | null;
  onProgress?: (p: { pct: number; message: string }) => void;
}): Promise<GrantImportBatchPreview> {
  input.onProgress?.({ pct: 3, message: 'Parsing Excel' });
  const rawRows = parseTpGatewayDisbursementXlsx(input.filepath);

  input.onProgress?.({ pct: 10, message: 'Validating rows' });
  const parsed = rawRows.map((r) => validateTpGatewayDisbursementRow(normalizeAndParseTpGatewayRow(r.rowNumber, r.raw)));

  input.onProgress?.({ pct: 18, message: 'Checking duplicates' });
  const ftxList = parsed
    .map((r) => r.financialTransactionId)
    .filter((x): x is string => !!x);
  const duplicates = await findDuplicateFtx([...new Set(ftxList)]);
  const dupMap = new Map<string, string>();
  for (const d of duplicates) dupMap.set(d.ftx, d.previousBatchId);

  const matched: GrantImportRowMatched[] = [];
  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || 'app1').trim() || 'app1';
  const qbSyncedEnrolments = new Set<string>();
  let qbSyncedRows = 0;
  const totalForProgress = Math.max(1, parsed.length);
  let progressed = 0;
  input.onProgress?.({ pct: 22, message: 'Matching to grants' });

  // Batch DB lookups: these were previously per-row and dominate runtime on big files.
  const grantIdsUnique = Array.from(
    new Set(parsed.map((r) => String(r.grantId || '').trim()).filter(Boolean))
  );
  const enrolmentIdsUnique = Array.from(
    new Set(parsed.filter((r) => r.validationStatus === 'valid' && r.enrolmentId).map((r) => String(r.enrolmentId!).trim()).filter(Boolean))
  );
  const [ssgExistsMap, alreadyAppliedSet, appliedQbPaymentIds, enrolmentExistsMap] = await Promise.all([
    ssgGrantExistsMany(grantIdsUnique),
    listAlreadyAppliedGrantIds(grantIdsUnique),
    getAppliedQbPaymentIdsByGrantId(grantIdsUnique),
    ssgEnrolmentExistsForFallback(enrolmentIdsUnique),
  ]);

  // QB lookups are very expensive. For large uploads, defer QB checks to preview/apply.
  const qbCheckMode = String(process.env.GRANT_IMPORT_STAGE1_QB_CHECK || '').trim().toLowerCase();
  const runQbChecks = qbCheckMode
    ? qbCheckMode === 'true' || qbCheckMode === '1' || qbCheckMode === 'yes'
    : parsed.length <= 120;

  const progressEvery = totalForProgress <= 80 ? 1 : 20;
  for (const row of parsed) {
    progressed += 1;
    if (progressed % progressEvery === 0 || progressed === totalForProgress) {
      const pct = 22 + Math.round((progressed / totalForProgress) * 55); // 22..77
      input.onProgress?.({ pct, message: `Matching rows (${progressed}/${totalForProgress})` });
    }
    if (row.validationStatus !== 'valid') {
      matched.push({
        ...row,
        matchStatus: 'invalid',
        matchedFmsRecordId: null,
        existingAmount: null,
        existingPaymentDate: null,
        matchedQbObjectId: null,
        duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
      });
      continue;
    }

    const grn = row.grantId!;
    const exists = ssgExistsMap.get(grn) || { ok: false };
    if (!exists.ok) {
      // Fallback: GRN not in ssg_grants — check if the enrolment exists in ssg_enrolments.
      // This handles enrolments whose QB invoices exist but whose grants were never synced into FMS.
      const enrId = String(row.enrolmentId || '').trim();
      if (!enrId || !enrolmentExistsMap.get(enrId)) {
        matched.push({
          ...row,
          matchStatus: 'unmatched',
          matchedFmsRecordId: null,
          existingAmount: null,
          existingPaymentDate: null,
          matchedQbObjectId: null,
          duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
        });
        continue;
      }
      // Enrolment found in FMS; proceed via QB invoice lookup (matchedFmsRecordId will be null).
      row.warnings.push({
        field: 'grant_id',
        message: 'Grant not in FMS (ssg_grants); matched via enrolment in ssg_enrolments',
      });
    }

    const alreadyAppliedLocal = alreadyAppliedSet.has(grn);
    // QuickBooks verification (preview): determine if a payment is already applied to THIS GRN's invoice
    // by checking for a Payment linked to the invoice with matching amount+date.
    let qbPaymentId: string | null = appliedQbPaymentIds.get(grn) ?? null;
    let qbExistingAmount: number | null = null;
    let qbExistingPaymentDate: string | null = null;
    if (qbPaymentId) {
      // QB payment ID already persisted from a previous apply — no live API call needed.
    } else if (runQbChecks) {
      try {
        const txnDate = String(row.paymentDateParsed || '').trim();
        const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
        for (const app of apps) {
          const inv = txnDate
            ? await qbResolveInvoiceForGrantRow({ app, grantId: grn, enrolmentId: row.enrolmentId, paymentDate: txnDate })
            : await qbResolveInvoiceForGrantRow({ app, grantId: grn, enrolmentId: row.enrolmentId });
          if (!inv?.id || !inv.customerRef || !txnDate || row.amountParsed == null) continue;
          const pays = await qbQueryPaymentsByCustomerAndDate(app, inv.customerRef, txnDate);
          const hit = pays.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, Number(row.amountParsed)));
          if (hit?.Id) {
            qbPaymentId = String(hit.Id);
            const totalAmt = Number(hit.TotalAmt);
            qbExistingAmount = Number.isFinite(totalAmt) ? totalAmt : null;
            qbExistingPaymentDate = hit.TxnDate ? String(hit.TxnDate) : null;
            break;
          }
        }
      } catch (e: unknown) {
        row.warnings.push({
          field: 'quickbooks',
          message: `QB check failed (preview only): ${e instanceof Error ? e.message : 'unknown error'}`,
        });
      }
    } else {
      // Speed: defer QB verification on large files. Apply step is still idempotent and will not create duplicates.
      row.warnings.push({
        field: 'quickbooks',
        message: 'QB check deferred for performance on large uploads; status will update in preview/apply.',
      });
    }

    // Match status reflects FMS state only. QB state is reported via matchedQbObjectId for UI.
    const alreadyApplied = alreadyAppliedLocal;
    matched.push({
      ...row,
      matchStatus: alreadyApplied ? 'already_applied' : 'ready',
      matchedFmsRecordId: exists.ssgGrantRowId ?? null,
      existingAmount: qbExistingAmount,
      existingPaymentDate: qbExistingPaymentDate,
      matchedQbObjectId: qbPaymentId,
      duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
    });
  }

  const totalRows = matched.length;
  const validRows = matched.filter((r) => r.validationStatus === 'valid').length;
  const readyRows = matched.filter((r) => r.matchStatus === 'ready').length;
  const alreadyAppliedRows = matched.filter((r) => r.matchStatus === 'already_applied').length;
  const unmatchedRows = matched.filter((r) => r.matchStatus === 'unmatched').length;
  const ambiguousRows = matched.filter((r) => r.matchStatus === 'ambiguous').length;
  const invalidRows = matched.filter((r) => r.matchStatus === 'invalid').length;

  const batch = await insertGrantImportBatch({
    uploadedBy: input.actorUserId,
    filename: input.filename,
    totals: {
      totalRows,
      validRows,
      readyRows,
      unmatchedRows,
      ambiguousRows,
      alreadyAppliedRows,
    },
  });

  input.onProgress?.({ pct: 82, message: 'Saving rows' });
  await insertGrantImportRows(
    batch.id,
    matched.map((r) => ({
      row_number: r.rowNumber,
      financial_transaction_id: r.financialTransactionId,
      enrolment_id: r.enrolmentId,
      grant_id: r.grantId,
      course_title: r.courseTitle,
      scheme: r.scheme,
      trainee_id: r.traineeId,
      trainee_name: r.traineeName,
      employer_name: r.employerName,
      amount_raw: r.amountRaw,
      amount_parsed: r.amountParsed,
      payment_date_raw: r.paymentDateRaw,
      payment_date_parsed: r.paymentDateParsed,
      bank_reference_id: r.bankReferenceId,
      funding_component: r.fundingComponent,
      raw_row_json: r.rawRowJson,
      validation_status: r.validationStatus,
      validation_errors: JSON.stringify({
        errors: r.validationErrors,
        warnings: r.warnings,
        duplicateFinancialTransactionIdBatchId: r.duplicateFinancialTransactionIdBatchId,
      }),
      match_status: r.matchStatus,
      matched_fms_record_id: r.matchedFmsRecordId,
      matched_qb_object_id: r.matchedQbObjectId,
      existing_amount: r.existingAmount,
      existing_payment_date: r.existingPaymentDate,
      // Default selection should be explicit by user action (or "Select all Ready"),
      // so the Selected count reflects only what the user chose.
      selected_for_apply: false,
      apply_status: r.matchStatus === 'already_applied' && r.matchedQbObjectId ? 'applied' : null,
      apply_error: null,
      applied_at: r.matchStatus === 'already_applied' && r.matchedQbObjectId ? new Date().toISOString() : null,
    }))
  );

  // If QB already had payments (but FMS didn't), sync rollups immediately so Consolidated Finance reflects reality.
  // This is still "safe": no QB writes, only enrolment rollup updates.
  if (qbSyncedEnrolments.size > 0) {
    try {
      input.onProgress?.({ pct: 92, message: 'Updating FMS rollups' });
      await recalcAndPersistGrantPaymentRollups(Array.from(qbSyncedEnrolments), new Date());
    } catch {
      // Non-blocking: preview still works even if rollup update fails
    }
  }

  input.onProgress?.({ pct: 96, message: 'Building preview' });
  // Enrolment impact preview (computed in-memory)
  const enrolmentIds = Array.from(
    new Set(matched.map((r) => r.enrolmentId).filter((x): x is string => !!x))
  );
  const expectedMap = await sumExpectedByEnrolmentFromSsgGrants(enrolmentIds);
  const receivedMap = await sumAppliedReceivedByEnrolment(enrolmentIds);

  const willReceiveByEnr = new Map<string, number>();
  for (const row of matched) {
    if (!row.enrolmentId) continue;
    if (row.matchStatus !== 'ready') continue;
    const amt = Number(row.amountParsed) || 0;
    willReceiveByEnr.set(row.enrolmentId, (willReceiveByEnr.get(row.enrolmentId) || 0) + amt);
  }

  const enrolmentImpact = enrolmentIds.map((enrolmentId) => {
    const expectedTotal = expectedMap.has(enrolmentId) ? expectedMap.get(enrolmentId)! : null;
    const receivedSoFar = receivedMap.get(enrolmentId) || 0;
    const willReceiveIfApplied = willReceiveByEnr.get(enrolmentId) || 0;
    const projectedReceived = receivedSoFar + willReceiveIfApplied;
    const projectedPending = expectedTotal == null ? null : Math.max(0, expectedTotal - projectedReceived);
    const projectedStatus: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID' =
      expectedTotal != null && projectedPending === 0
        ? 'FULLY_PAID'
        : projectedReceived > 0
          ? 'PARTIAL'
          : 'NOT_RECEIVED';
    return {
      enrolmentId,
      expectedTotal,
      receivedSoFar,
      willReceiveIfApplied,
      projectedReceived,
      projectedPending,
      projectedStatus,
    };
  });

  return {
    batch: {
      id: batch.id,
      filename: batch.filename ?? null,
      uploadedAt: batch.uploaded_at,
      uploadedBy: batch.uploaded_by ?? null,
      status: batch.status,
    },
    summary: {
      totalRows,
      validRows,
      readyRows,
      alreadyAppliedRows,
      unmatchedRows,
      ambiguousRows,
      invalidRows,
      duplicateFtxRows: duplicates.length,
      qbSyncedRows,
    },
    enrolmentImpact,
    rows: matched,
    duplicateFinancialTransactionIds: duplicates.map((d) => ({ ftx: d.ftx, previousBatchId: d.previousBatchId })),
  };
}

