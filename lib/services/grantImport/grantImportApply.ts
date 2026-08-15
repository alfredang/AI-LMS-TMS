import {
  clearApplyStateForSelectedRows,
  clearApplyStateForSpecificRows,
  insertGrantImportAuditLog,
  listApplyCandidates,
  listGrantIdsForEnrolmentFromImportHistory,
  markBatchStatus,
  updateBatchCounts,
  updateRowApplyResult,
} from './grantImportDb';
import { recalcAndPersistGrantPaymentRollups } from './grantImportRollup';
import {
  qboQuery,
  qboCreatePayment as qboCreatePaymentSvc,
  qboReadPayment as qboReadPaymentSvc,
  qboVoidPayment as qboVoidPaymentSvc,
} from '@/lib/services/qboInvoiceService';
import pool from '@/lib/db';

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

const QB_ACCOUNT_ID_BY_NAME_PROMISE = new Map<string, Promise<string | null>>();
const QB_PAYMENT_METHOD_ID_BY_NAME_PROMISE = new Map<string, Promise<string | null>>();

async function qbFindInvoiceByDocNumber(app: string | undefined, docNumber: string): Promise<{ id: string; customerRef?: string } | null> {
  const safe = escapeQbQueryString(String(docNumber || '').trim());
  if (!safe) return null;
  const data = await qboQuery(app, `SELECT * FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1`);
  const inv = data?.QueryResponse?.Invoice;
  const row = Array.isArray(inv) ? inv[0] : inv;
  if (!row?.Id) return null;
  return { id: String(row.Id), customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined };
}

async function qbGetInvoiceBalance(app: string | undefined, invoiceId: string): Promise<number | null> {
  const safe = escapeQbQueryString(String(invoiceId || '').trim());
  if (!safe) return null;
  const data = await qboQuery(app, `SELECT Id, Balance FROM Invoice WHERE Id = '${safe}' MAXRESULTS 1`);
  const inv = data?.QueryResponse?.Invoice;
  const row = Array.isArray(inv) ? inv[0] : inv;
  const bal = Number(row?.Balance);
  return Number.isFinite(bal) ? bal : null;
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
  | { id: string; customerRef?: string; resolvedBy: 'docNumber' | 'enrolment_grant_docNumber' | 'date_window_scan' }
  | null
> {
  const direct = await qbFindInvoiceByDocNumber(input.app, input.grantId);
  if (direct?.id) return { ...direct, resolvedBy: 'docNumber' };

  // A grant that isn't itself the invoice's DocNumber is usually a secondary funding
  // component (e.g. MCES) billed on another grant's invoice for the same enrolment
  // (see the invoice screenshot: one invoice, one line per grant ref). QBO's query
  // language doesn't support filtering by Line.Description at all (confirmed: QBO
  // rejects it outright with "not queryable", every time — it's not a per-realm quirk),
  // so the only reliable way to find that invoice is via a sibling grant_id's DocNumber.
  if (input.enrolmentId) {
    const [ssgGrns, historyGrns] = await Promise.all([
      listSsgGrantIdsForEnrolment(input.enrolmentId),
      listGrantIdsForEnrolmentFromImportHistory(input.enrolmentId),
    ]);
    const grns = Array.from(new Set([...ssgGrns, ...historyGrns])).filter((g) => g && g !== input.grantId);
    for (const grn of grns) {
      const hit = await qbFindInvoiceByDocNumber(input.app, grn);
      if (hit?.id) return { ...hit, resolvedBy: 'enrolment_grant_docNumber' };
    }
  }

  // Last resort: scan invoices near the payment date and inspect their lines client-side.
  if (input.paymentDate) {
    const scanned = await qbFindInvoiceByScanningRecentInvoices(input.app, input.grantId, input.paymentDate);
    if (scanned?.id) return { ...scanned, resolvedBy: 'date_window_scan' };
  }
  return null;
}

async function qbResolveInvoiceForGrantRowAcrossApps(input: {
  preferredApp: string;
  grantId: string;
  enrolmentId: string | null;
  paymentDate?: string | null;
}): Promise<
  | {
      app: string;
      id: string;
      customerRef?: string;
      resolvedBy: 'docNumber' | 'enrolment_grant_docNumber' | 'date_window_scan';
    }
  | null
> {
  const pref = String(input.preferredApp || '').trim() || 'app1';
  const apps = pref === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
  for (const app of apps) {
    try {
      const hit = await qbResolveInvoiceForGrantRow({
        app,
        grantId: input.grantId,
        enrolmentId: input.enrolmentId,
        paymentDate: input.paymentDate,
      });
      if (hit?.id) return { app, ...hit };
    } catch (e) {
      // A broken/unconfigured fallback app (e.g. stale refresh token) must not fail
      // the whole row — invoice generation only ever touches the primary app, so
      // grant matching should degrade the same way: skip this app, try the next.
      console.warn(
        `[grantImportApply] QB lookup failed for app=${app} (grant ${input.grantId}), trying next app:`,
        e instanceof Error ? e.message : e
      );
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
  // Performance: keep the scan window tight.
  // Scanning too many invoices can make a single-row apply take 30-60s locally.
  const start = new Date(d.getTime() - 60 * 24 * 60 * 60 * 1000);
  const endIso = fmtIsoDate(end);
  const startIso = fmtIsoDate(start);

  const pageSize = 100;
  const maxPages = 3; // up to 300 invoices in window
  for (let page = 0; page < maxPages; page++) {
    const startPos = page * pageSize + 1;
    const data = await qboQuery(app, `SELECT * FROM Invoice WHERE TxnDate >= '${startIso}' AND TxnDate <= '${endIso}' STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
    const rows = data?.QueryResponse?.Invoice;
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (arr.length === 0) return null;
    const hit = arr.find((inv: any) => invoiceHasGrantInDescription(inv, grantId));
    if (hit?.Id) {
      return { id: String(hit.Id), customerRef: hit?.CustomerRef?.value ? String(hit.CustomerRef.value) : undefined };
    }
    if (arr.length < pageSize) return null;
  }
  return null;
}

async function qbQueryPaymentsByCustomerAndDate(
  app: string | undefined,
  customerRef: string,
  txnDate: string
): Promise<any[]> {
  const safeCust = escapeQbQueryString(String(customerRef || '').trim());
  const safeDate = escapeQbQueryString(String(txnDate || '').trim());
  if (!safeCust || !safeDate) return [];
  // A single busy settlement day for this customer can exceed 200 payments (confirmed: 100+ on
  // one day alone in this company's data) — page through rather than silently truncating.
  const all: any[] = [];
  let page = 1;
  while (page <= 20) {
    const startPos = (page - 1) * 1000 + 1;
    const data = await qboQuery(app, `SELECT * FROM Payment WHERE CustomerRef = '${safeCust}' AND TxnDate = '${safeDate}' STARTPOSITION ${startPos} MAXRESULTS 1000`);
    const rows = data?.QueryResponse?.Payment;
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    all.push(...arr);
    if (arr.length < 1000) break;
    page++;
  }
  return all;
}

async function qbQueryPaymentByRefNum(app: string | undefined, paymentRefNum: string): Promise<any | null> {
  const safe = escapeQbQueryString(String(paymentRefNum || '').trim());
  if (!safe) return null;
  const data = await qboQuery(app, `SELECT * FROM Payment WHERE PaymentRefNum = '${safe}' MAXRESULTS 1`);
  const rows = data?.QueryResponse?.Payment;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row?.Id ? row : null;
}

async function qbQueryPaymentsByRefNum(app: string | undefined, paymentRefNum: string): Promise<any[]> {
  const safe = escapeQbQueryString(String(paymentRefNum || '').trim());
  if (!safe) return [];
  // One real bank reference commonly covers hundreds of individually-created Payment records
  // (one per invoice in a bulk disbursement) — confirmed up to 674 for a single ref in this
  // company's data. A single MAXRESULTS-200 page silently misses the rest, which broke the
  // idempotency check for invoices whose matching payment fell outside the first page. Page
  // through with a generous safety cap.
  const all: any[] = [];
  let page = 1;
  while (page <= 20) {
    const startPos = (page - 1) * 1000 + 1;
    const data = await qboQuery(app, `SELECT * FROM Payment WHERE PaymentRefNum = '${safe}' STARTPOSITION ${startPos} MAXRESULTS 1000`);
    const rows = data?.QueryResponse?.Payment;
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    all.push(...arr);
    if (arr.length < 1000) break;
    page++;
  }
  return all;
}

async function qbFindAccountIdByName(app: string | undefined, name: string): Promise<string | null> {
  const n = String(name || '').trim();
  if (!n) return null;
  const cacheKey = `${String(app || '')}::${n.toLowerCase()}`;
  const existing = QB_ACCOUNT_ID_BY_NAME_PROMISE.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    const safe = escapeQbQueryString(n);
    // Exact match first
    const exact = await qboQuery(app, `SELECT * FROM Account WHERE Name = '${safe}' MAXRESULTS 1`);
    const exactRows = exact?.QueryResponse?.Account;
    const exactRow = Array.isArray(exactRows) ? exactRows[0] : exactRows;
    if (exactRow?.Id) return String(exactRow.Id);

    // Fallback: some companies have slightly different suffixes, e.g. "DBS Bank" vs "DBS Bank - SGD".
    const like = await qboQuery(app, `SELECT * FROM Account WHERE Name LIKE '${safe.replace(/%/g, '\\%')}%' MAXRESULTS 50`);
    const likeRows = like?.QueryResponse?.Account;
    const likeArr = Array.isArray(likeRows) ? likeRows : likeRows ? [likeRows] : [];
    const found =
      likeArr.find((a: any) => String(a?.Name || '').toLowerCase() === n.toLowerCase()) ||
      likeArr.find((a: any) => String(a?.Name || '').toLowerCase().startsWith(n.toLowerCase())) ||
      likeArr.find((a: any) => String(a?.AccountType || '').toLowerCase() === 'bank') ||
      likeArr[0];
    return found?.Id ? String(found.Id) : null;
  })()
    .catch((e) => {
      // Don't poison cache on transient QB errors
      QB_ACCOUNT_ID_BY_NAME_PROMISE.delete(cacheKey);
      throw e;
    });

  QB_ACCOUNT_ID_BY_NAME_PROMISE.set(cacheKey, p);
  return p;
}

async function qbFindBankAccountIdByNameContains(app: string | undefined, nameContains: string): Promise<string | null> {
  const t = String(nameContains || '').trim();
  if (!t) return null;
  const cacheKey = `${String(app || '')}::bank_contains::${t.toLowerCase()}`;
  const existing = QB_ACCOUNT_ID_BY_NAME_PROMISE.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    const safe = escapeQbQueryString(t);
    const data = await qboQuery(app, `SELECT * FROM Account WHERE AccountType = 'Bank' AND Name LIKE '%${safe.replace(/%/g, '\\%')}%' MAXRESULTS 50`);
    const rows = data?.QueryResponse?.Account;
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const found =
      arr.find((a: any) => String(a?.Name || '').toLowerCase() === t.toLowerCase()) ||
      arr.find((a: any) => String(a?.Name || '').toLowerCase().includes(t.toLowerCase())) ||
      arr[0];
    return found?.Id ? String(found.Id) : null;
  })()
    .catch((e) => {
      QB_ACCOUNT_ID_BY_NAME_PROMISE.delete(cacheKey);
      throw e;
    });

  QB_ACCOUNT_ID_BY_NAME_PROMISE.set(cacheKey, p);
  return p;
}

async function qbFindPaymentMethodIdByName(app: string | undefined, name: string): Promise<string | null> {
  const n = String(name || '').trim();
  if (!n) return null;
  const cacheKey = `${String(app || '')}::pm::${n.toLowerCase()}`;
  const existing = QB_PAYMENT_METHOD_ID_BY_NAME_PROMISE.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    const safe = escapeQbQueryString(n);
    const data = await qboQuery(app, `SELECT * FROM PaymentMethod WHERE Name = '${safe}' MAXRESULTS 1`);
    const rows = data?.QueryResponse?.PaymentMethod;
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.Id ? String(row.Id) : null;
  })().catch((e) => {
    QB_PAYMENT_METHOD_ID_BY_NAME_PROMISE.delete(cacheKey);
    throw e;
  });

  QB_PAYMENT_METHOD_ID_BY_NAME_PROMISE.set(cacheKey, p);
  return p;
}

function paymentLinksInvoiceAndAmount(p: any, invoiceId: string, amount: number): boolean {
  const lines = p?.Line;
  const arr = Array.isArray(lines) ? lines : lines ? [lines] : [];
  for (const ln of arr) {
    const linked = ln?.LinkedTxn;
    const larr = Array.isArray(linked) ? linked : linked ? [linked] : [];
    const hasLink = larr.some((x: any) => String(x?.TxnType || '') === 'Invoice' && String(x?.TxnId || '') === String(invoiceId));
    if (!hasLink) continue;
    const a = Number(ln?.Amount);
    if (Number.isFinite(a) && Math.abs(a - amount) < 0.01) return true;
  }
  return false;
}

async function qbReadPayment(
  app: string | undefined,
  paymentId: string
): Promise<{
  id: string;
  syncToken?: string;
  txnDate?: string;
  paymentRefNum?: string;
  depositToAccountId?: string;
  paymentMethodId?: string;
} | null> {
  const result = await qboReadPaymentSvc(app, paymentId);
  if (!result?.id) return null;
  const p = result.raw;
  return {
    id: String(p.Id),
    syncToken: p?.SyncToken ? String(p.SyncToken) : undefined,
    txnDate: p?.TxnDate ? String(p.TxnDate) : undefined,
    paymentRefNum: p?.PaymentRefNum ? String(p.PaymentRefNum) : undefined,
    depositToAccountId: p?.DepositToAccountRef?.value ? String(p.DepositToAccountRef.value) : undefined,
    paymentMethodId: p?.PaymentMethodRef?.value ? String(p.PaymentMethodRef.value) : undefined,
  };
}

async function qbVoidPayment(app: string | undefined, paymentId: string, syncToken: string): Promise<void> {
  await qboVoidPaymentSvc(app, paymentId, syncToken);
}

async function qbCreatePayment(app: string | undefined, body: any): Promise<{ id: string }> {
  const result = await qboCreatePaymentSvc(app, body);
  if (!result?.id) throw new Error('QB payment create returned no Id');
  return { id: result.id };
}

function toNum(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function applyGrantImportBatch(input: {
  batchId: string;
  actorUserId: string | null;
  dryRun: boolean;
  allowOverwriteAlreadyApplied: boolean;
  /** When provided, only these row IDs are processed (overrides DB selected_for_apply). */
  rowIds?: string[];
}): Promise<{
  batchId: string;
  summary: { totalSelected: number; applied: number; skipped: number; failed: number };
  results: Array<{ rowId: string; ok: boolean; status: 'applied' | 'skipped' | 'failed'; error?: string }>;
  enrolmentRollups: { updated: number; results: any[]; pending?: boolean };
}> {
  await markBatchStatus(input.batchId, 'applying', input.actorUserId);
  await insertGrantImportAuditLog({
    batchId: input.batchId,
    rowId: null,
    eventType: 'apply_start',
    actorUserId: input.actorUserId,
    details: { dryRun: input.dryRun, allowOverwriteAlreadyApplied: input.allowOverwriteAlreadyApplied },
  });

  // Reset apply fields for this run so polling UI can show accurate done/total (terminal statuses only).
  if (input.rowIds && input.rowIds.length > 0) {
    await clearApplyStateForSpecificRows(input.batchId, input.rowIds);
  } else {
    await clearApplyStateForSelectedRows(input.batchId);
  }

  const rows = await listApplyCandidates(input.batchId);
  let selected: typeof rows;
  if (input.rowIds && input.rowIds.length > 0) {
    const idSet = new Set(input.rowIds);
    selected = rows.filter((r) => idSet.has(r.id));
  } else {
    selected = rows.filter((r) => r.selected_for_apply);
  }
  const totalSelected = selected.length;

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ rowId: string; ok: boolean; status: 'applied' | 'skipped' | 'failed'; error?: string }> = [];
  const affectedEnrolments = new Set<string>();
  // Prefer the same default-app logic as invoice generation:
  // QUICKBOOKS_DEFAULT_APP (if configured) otherwise app1.
  // QBO_GRANT_IMPORT_APP can still override when explicitly set.
  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';

  for (const row of selected) {
    const rowId = row.id;
    try {
      const match = String(row.match_status || '');
      if (match === 'invalid' || match === 'unmatched' || match === 'ambiguous') {
        skipped += 1;
        await updateRowApplyResult({ rowId, applyStatus: 'skipped', applyError: `Not applicable for match_status=${match}` });
        await insertGrantImportAuditLog({
          batchId: input.batchId,
          rowId,
          eventType: 'skip',
          actorUserId: input.actorUserId,
          details: { reason: 'not_applicable', match_status: match },
        });
        results.push({ rowId, ok: true, status: 'skipped' });
        continue;
      }

      // Mark pending while applying (for UI progress)
      await updateRowApplyResult({ rowId, applyStatus: 'pending', applyError: null });

      // QB update step
      if (input.dryRun) {
        skipped += 1;
        await updateRowApplyResult({ rowId, applyStatus: 'skipped', applyError: 'Dry-run: no QB writes performed', matchedQbObjectId: null });
        await insertGrantImportAuditLog({
          batchId: input.batchId,
          rowId,
          eventType: 'skip',
          actorUserId: input.actorUserId,
          details: {
            reason: 'dry_run',
            grant_id: row.grant_id,
            enrolment_id: row.enrolment_id,
            amount: toNum(row.amount_parsed),
            payment_date: row.payment_date_parsed,
          },
        });
        results.push({ rowId, ok: true, status: 'skipped' });
        continue;
      }

      const grantId = String(row.grant_id || '').trim();
      if (!grantId) throw new Error('Missing grant_id');
      const amount = toNum(row.amount_parsed);
      if (!amount || amount <= 0) throw new Error('Invalid amount');
      const txnDate = String(row.payment_date_parsed || '').trim();
      if (!txnDate) throw new Error('Missing payment_date');

      const inv = await qbResolveInvoiceForGrantRowAcrossApps({
        preferredApp: appOverride,
        grantId,
        enrolmentId: row.enrolment_id,
        paymentDate: txnDate,
      });
      if (!inv?.id) throw new Error(`No QuickBooks invoice found for grant ${grantId} (tried DocNumber, sibling GRNs for this enrolment, then a date-window scan)`);
      const customerRef = inv.customerRef;
      if (!customerRef) throw new Error(`QuickBooks invoice ${grantId} has no CustomerRef`);

      const refNum = String(row.bank_reference_id || row.financial_transaction_id || '').trim();

      // Idempotency: if QB already has a payment linked to this invoice+amount on this payment date, do NOT create another.
      // This MUST run before the balance guard below — otherwise a row whose exact payment is
      // already correctly applied gets rejected as "exceeds balance" instead of recognized as done,
      // since the invoice's balance is (correctly) already zero from that same existing payment.
      const sameDatePayments = await qbQueryPaymentsByCustomerAndDate(inv.app, customerRef, txnDate);
      const existingLinked = sameDatePayments.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, amount));
      if (existingLinked?.Id && !input.allowOverwriteAlreadyApplied) {
        applied += 1;
        const appliedAt = new Date().toISOString();
        await updateRowApplyResult({
          rowId,
          applyStatus: 'applied',
          applyError: null,
          appliedAt,
          matchedQbObjectId: String(existingLinked.Id),
        });
        if (row.enrolment_id) affectedEnrolments.add(String(row.enrolment_id));
        await insertGrantImportAuditLog({
          batchId: input.batchId,
          rowId,
          eventType: 'apply_success',
          actorUserId: input.actorUserId,
          details: {
            dryRun: false,
            reason: 'qb_payment_already_exists_for_invoice_amount_date_sync_fms_only',
            grant_id: grantId,
            qb_invoice_id: inv.id,
            qb_payment_id: String(existingLinked.Id),
            qb_app: inv.app,
            payment_ref_num: refNum || null,
            amount,
            payment_date: txnDate,
          },
        });
        results.push({ rowId, ok: true, status: 'applied' });
        continue;
      }

      // Second idempotency angle: match by PaymentRefNum (falls back to customer+date if no refNum).
      // Bank Reference IDs can repeat across multiple invoices, so only treat it as an "existing"
      // duplicate if a payment with this ref is linked to the *same* invoice + amount + date.
      // Runs before the balance guard below, same reasoning as the check above.
      if (refNum) {
        const candidates = await qbQueryPaymentsByRefNum(inv.app, refNum);
        const hit = candidates.find((p: any) => {
          const links = paymentLinksInvoiceAndAmount(p, inv.id, amount);
          const sameDate = String(p?.TxnDate || '').trim() === txnDate;
          return links && sameDate;
        });

        if (hit?.Id) {
          const existingId = String(hit.Id);
          const existingSync = hit.SyncToken ? String(hit.SyncToken) : undefined;

          if (!input.allowOverwriteAlreadyApplied) {
            applied += 1;
            const appliedAt = new Date().toISOString();
            await updateRowApplyResult({
              rowId,
              applyStatus: 'applied',
              applyError: null,
              appliedAt,
              matchedQbObjectId: existingId,
            });
            if (row.enrolment_id) affectedEnrolments.add(String(row.enrolment_id));
            await insertGrantImportAuditLog({
              batchId: input.batchId,
              rowId,
              eventType: 'apply_success',
              actorUserId: input.actorUserId,
              details: {
                reason: 'qb_payment_exists_refnum_sync_fms_only',
                qb_payment_id: existingId,
                payment_ref_num: refNum,
                qb_invoice_id: inv.id,
                amount,
                payment_date: txnDate,
              },
            });
            results.push({ rowId, ok: true, status: 'applied' });
            continue;
          }

          // Overwrite allowed → void the matching payment then recreate.
          if (existingSync) {
            try {
              await qbVoidPayment(inv.app, existingId, existingSync);
            } catch {
              // best-effort
            }
          } else {
            try {
              const existing = await qbReadPayment(inv.app, existingId);
              if (existing?.syncToken) await qbVoidPayment(inv.app, existingId, String(existing.syncToken));
            } catch {
              // best-effort
            }
          }
        }
      } else {
        // Fallback safety: detect an existing payment by customer+date linked to invoice+amount.
        // Only applied when we don't have a reliable PaymentRefNum.
        const candidates = await qbQueryPaymentsByCustomerAndDate(inv.app, customerRef, txnDate);
        const hit = candidates.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, amount));
        if (hit?.Id) {
          const existingId = String(hit.Id);
          const existingSync = hit.SyncToken ? String(hit.SyncToken) : undefined;

          if (!input.allowOverwriteAlreadyApplied) {
            applied += 1;
            const appliedAt = new Date().toISOString();
            await updateRowApplyResult({
              rowId,
              applyStatus: 'applied',
              applyError: null,
              appliedAt,
              matchedQbObjectId: existingId,
            });
            if (row.enrolment_id) affectedEnrolments.add(String(row.enrolment_id));
            await insertGrantImportAuditLog({
              batchId: input.batchId,
              rowId,
              eventType: 'apply_success',
              actorUserId: input.actorUserId,
              details: {
                reason: 'qb_payment_exists_customer_date_sync_fms_only',
                qb_payment_id: existingId,
                qb_invoice_id: inv.id,
                amount,
                payment_date: txnDate,
              },
            });
            results.push({ rowId, ok: true, status: 'applied' });
            continue;
          }

          if (existingSync) {
            try {
              await qbVoidPayment(inv.app, existingId, existingSync);
            } catch {
              // best-effort
            }
          }
        }
      }

      // Overwrite behavior: if we previously created a payment for this row, void it first (so we don't double-count).
      if (match === 'already_applied' && input.allowOverwriteAlreadyApplied && row.matched_qb_object_id) {
        try {
          const existing = await qbReadPayment(inv.app, String(row.matched_qb_object_id));
          if (existing?.syncToken) {
            await qbVoidPayment(inv.app, String(row.matched_qb_object_id), String(existing.syncToken));
          }
        } catch {
          // best-effort; proceed to create a new payment
        }
      }

      // If overwrite is enabled but we don't have a stored Payment Id, attempt best-effort detection:
      // find an existing payment for same customer+date that is linked to the invoice with same amount,
      // then void it so we can recreate it with the correct PaymentRefNum.
      if (match === 'already_applied' && input.allowOverwriteAlreadyApplied && !row.matched_qb_object_id) {
        try {
          const candidates = await qbQueryPaymentsByCustomerAndDate(inv.app, customerRef, txnDate);
          const hit = candidates.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, amount));
          if (hit?.Id && hit?.SyncToken) {
            await qbVoidPayment(inv.app, String(hit.Id), String(hit.SyncToken));
          }
        } catch {
          // best-effort
        }
      }

      // Safety guard: never create a payment for more than the resolved invoice actually owes.
      // Every grant invoice bills to one shared QBO customer, and this company's
      // AutoApplyPayments setting silently spills any excess onto that customer's OTHER open
      // invoices when one can't absorb the full amount — the mechanism behind payments (dated
      // and amounted correctly) ending up cross-linked to invoices they were never meant for,
      // usually because a loose fallback match (line-description / same-enrolment) picked the
      // wrong invoice. Refuse rather than let QB silently redistribute the difference.
      // Runs here (after all the idempotency/overwrite-void checks above, not before) so a row
      // whose exact payment is already correctly applied is recognized as done rather than
      // rejected, and so an overwrite's void-then-recreate has already freed the balance it needs.
      const invoiceBalance = await qbGetInvoiceBalance(inv.app, inv.id);
      if (invoiceBalance == null) {
        throw new Error(`Could not read balance for QuickBooks invoice ${inv.id} (grant ${grantId}); refusing to apply blind`);
      }
      if (amount - invoiceBalance > 0.01) {
        throw new Error(
          `Payment amount ${amount.toFixed(2)} exceeds invoice ${grantId} (QB id ${inv.id}) remaining balance ${invoiceBalance.toFixed(2)} — ` +
            `likely resolved to the wrong invoice; not applying (QuickBooks would spill the excess onto other invoices under AutoApplyPayments)`
        );
      }

      const paymentBody: any = {
        CustomerRef: { value: customerRef },
        TotalAmt: Number(amount.toFixed(2)),
        TxnDate: txnDate,
        Line: [
          {
            Amount: Number(amount.toFixed(2)),
            LinkedTxn: [{ TxnId: inv.id, TxnType: 'Invoice' }],
          },
        ],
      };

      if (refNum) paymentBody.PaymentRefNum = refNum;

      const pm = (process.env.QBO_GRANT_PAYMENT_METHOD_REF || '').trim();
      if (pm) paymentBody.PaymentMethodRef = { value: pm };
      if (!paymentBody.PaymentMethodRef) {
        const giroId = await qbFindPaymentMethodIdByName(inv.app, 'GIRO').catch(() => null);
        if (!giroId) throw new Error('Could not resolve QuickBooks PaymentMethod "GIRO"');
        paymentBody.PaymentMethodRef = { value: giroId };
      }
      // Business rule: Money deposited to should be DBS Bank (default "DBS Bank - SGD").
      // Resolve by account *name* via QB query (cached), with env id fallback.
      const depName = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_NAME || 'DBS Bank - SGD').trim();
      const depByName =
        (await qbFindAccountIdByName(inv.app, depName).catch(() => null)) ||
        // fallback: some QBO charts omit currency suffix in name
        (depName.toLowerCase().endsWith('- sgd')
          ? await qbFindAccountIdByName(inv.app, depName.replace(/\s*-\s*sgd\s*$/i, '').trim()).catch(() => null)
          : null);
      const depByBankContains =
        depByName ||
        (depName.toLowerCase().includes('dbs') ? await qbFindBankAccountIdByNameContains(inv.app, 'DBS Bank').catch(() => null) : null);
      const depByEnv = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_REF_DBS || process.env.QBO_GRANT_DEPOSIT_ACCOUNT_REF || '').trim();
      const dep = depByBankContains || depByEnv;
      if (!dep) {
        // Hard requirement: never allow QB to default to Undeposited Funds.
        // If we can't resolve DBS deposit account, fail the row so it can be retried safely after fixing config.
        throw new Error(
          `Could not resolve QuickBooks deposit account for "${depName}". ` +
            `Set env QBO_GRANT_DEPOSIT_ACCOUNT_NAME (account Name) or QBO_GRANT_DEPOSIT_ACCOUNT_REF_DBS (account Id) and retry.`
        );
      }
      paymentBody.DepositToAccountRef = { value: dep };

      const created = await qbCreatePayment(inv.app, paymentBody);
      if (!created?.id) throw new Error('QuickBooks payment creation returned no Id');

      // Verify QB actually saved the critical fields. If not, fail loudly so we never silently produce bad data.
      const saved = await qbReadPayment(inv.app, created.id);
      const wantPm = paymentBody?.PaymentMethodRef?.value ? String(paymentBody.PaymentMethodRef.value) : null;
      const wantDep = dep ? String(dep) : null;
      const wantRef = refNum ? String(refNum) : null;
      const wantDate = txnDate ? String(txnDate) : null;
      const ok =
        !!saved?.id &&
        (!wantDate || String(saved?.txnDate || '') === wantDate) &&
        (!wantRef || String(saved?.paymentRefNum || '') === wantRef) &&
        (!wantDep || String(saved?.depositToAccountId || '') === wantDep) &&
        (!wantPm || String(saved?.paymentMethodId || '') === wantPm);
      if (!ok) {
        // Best-effort: void the newly created payment so it doesn't linger as incorrect/undesired.
        try {
          if (saved?.syncToken) await qbVoidPayment(inv.app, saved.id, String(saved.syncToken));
        } catch {
          // ignore
        }
        throw new Error(
          `QuickBooks saved unexpected fields for created payment ${created.id}. ` +
            `Expected date=${wantDate}, ref=${wantRef}, depositTo=${wantDep}, method=${wantPm}. ` +
            `Got date=${saved?.txnDate || ''}, ref=${saved?.paymentRefNum || ''}, depositTo=${saved?.depositToAccountId || ''}, method=${saved?.paymentMethodId || ''}.`
        );
      }

      // Verify the payment actually linked to the invoice — matching metadata fields alone (above)
      // is not enough: QB has silently saved a payment's date/ref/deposit/method while dropping its
      // Line/LinkedTxn, leaving an orphaned unapplied payment while this code reported success.
      const invoiceBalanceAfter = await qbGetInvoiceBalance(inv.app, inv.id);
      if (invoiceBalanceAfter == null || invoiceBalanceAfter > invoiceBalance - amount + 0.01) {
        try {
          if (saved?.syncToken) await qbVoidPayment(inv.app, saved.id, String(saved.syncToken));
        } catch {
          // best-effort
        }
        throw new Error(
          `QuickBooks payment ${created.id} was created but never linked to invoice ${inv.id} ` +
            `(balance before: ${invoiceBalance.toFixed(2)}, after: ${invoiceBalanceAfter == null ? 'unreadable' : invoiceBalanceAfter.toFixed(2)}, expected ~${(invoiceBalance - amount).toFixed(2)}). ` +
            `Voided the orphaned payment; not marking this row as applied.`
        );
      }

      applied += 1;
      const appliedAt = new Date().toISOString();
      await updateRowApplyResult({ rowId, applyStatus: 'applied', applyError: null, appliedAt, matchedQbObjectId: created.id });
      await insertGrantImportAuditLog({
        batchId: input.batchId,
        rowId,
        eventType: 'apply_success',
        actorUserId: input.actorUserId,
        details: {
          dryRun: false,
          grant_id: grantId,
          qb_invoice_id: inv.id,
          qb_payment_id: created.id,
          qb_app: inv.app,
          qb_deposit_to_account_name: depName,
          qb_deposit_to_account_id: dep,
          qb_payment_method_id: wantPm,
          qb_payment_ref_num: wantRef,
          enrolment_id: row.enrolment_id,
          amount,
          payment_date: txnDate,
        },
      });

      if (row.enrolment_id) affectedEnrolments.add(String(row.enrolment_id));
      results.push({ rowId, ok: true, status: 'applied' });
    } catch (e: unknown) {
      failed += 1;
      const msg = e instanceof Error ? e.message : 'Apply failed';
      await updateRowApplyResult({ rowId, applyStatus: 'failed', applyError: msg });
      await insertGrantImportAuditLog({
        batchId: input.batchId,
        rowId,
        eventType: 'apply_fail',
        actorUserId: input.actorUserId,
        details: { error: msg },
      });
      results.push({ rowId, ok: false, status: 'failed', error: msg });
    }
  }

  // Post-steps can be slow (rollups + batch counts). Do them in background so UI isn't stuck
  // waiting after it already hit 100% done rows.
  const affected = Array.from(affectedEnrolments);
  void (async () => {
    try {
      const rollups = await recalcAndPersistGrantPaymentRollups(affected, new Date());
      await insertGrantImportAuditLog({
        batchId: input.batchId,
        rowId: null,
        eventType: 'enrolment_status_update',
        actorUserId: input.actorUserId,
        details: { updated: rollups.updated, enrolments: rollups.results },
      });
    } catch (e) {
      console.warn('[grant-import] rollup post-step failed:', e);
    }
    try {
      await updateBatchCounts(input.batchId);
    } catch (e) {
      console.warn('[grant-import] updateBatchCounts post-step failed:', e);
    }
    try {
      await markBatchStatus(input.batchId, 'completed', input.actorUserId);
    } catch (e) {
      console.warn('[grant-import] markBatchStatus(completed) post-step failed:', e);
    }
  })();

  return {
    batchId: input.batchId,
    summary: { totalSelected, applied, skipped, failed },
    results,
    enrolmentRollups: { updated: 0, results: [], pending: true },
  };
}

