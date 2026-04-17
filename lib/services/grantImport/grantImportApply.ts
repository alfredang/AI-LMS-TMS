import {
  insertGrantImportAuditLog,
  listApplyCandidates,
  markBatchStatus,
  updateBatchCounts,
  updateRowApplyResult,
} from './grantImportDb';
import { recalcAndPersistGrantPaymentRollups } from './grantImportRollup';
import pool from '@/lib/db';

type ProxyResponse<T = any> = { success: boolean; data?: T; error?: string; details?: unknown };

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

const QB_ACCOUNT_ID_BY_NAME_PROMISE = new Map<string, Promise<string | null>>();

async function callQbProxy(body: Record<string, any>): Promise<any> {
  const baseUrl = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
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

async function qbFindInvoiceByDocNumber(app: string | undefined, docNumber: string): Promise<{ id: string; customerRef?: string } | null> {
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
      query: `SELECT * FROM Invoice WHERE Line.Description LIKE '%${safe}%' MAXRESULTS 1`,
    });
    const inv = data?.QueryResponse?.Invoice;
    const row = Array.isArray(inv) ? inv[0] : inv;
    if (!row?.Id) return null;
    return { id: String(row.Id), customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined };
  } catch {
    // Some QBO realms reject nested Line queries; treat as "not found" instead of failing apply.
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
}): Promise<
  | { id: string; customerRef?: string; resolvedBy: 'docNumber' | 'line_description' | 'enrolment_grant_docNumber' | 'enrolment_grant_line_description' }
  | null
> {
  const direct = await qbFindInvoiceByDocNumber(input.app, input.grantId);
  if (direct?.id) return { ...direct, resolvedBy: 'docNumber' };
  const byDesc = await qbFindInvoiceByLineDescriptionContains(input.app, input.grantId);
  if (byDesc?.id) return { ...byDesc, resolvedBy: 'line_description' };

  // Fallback: if invoice DocNumber is the "primary" GRN for the enrolment, try other GRNs for same enrolment.
  if (input.enrolmentId) {
    const grns = await listSsgGrantIdsForEnrolment(input.enrolmentId);
    for (const grn of grns) {
      const hit = await qbFindInvoiceByDocNumber(input.app, grn);
      if (hit?.id) return { ...hit, resolvedBy: 'enrolment_grant_docNumber' };
      const hitDesc = await qbFindInvoiceByLineDescriptionContains(input.app, grn);
      if (hitDesc?.id) return { ...hitDesc, resolvedBy: 'enrolment_grant_line_description' };
    }
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
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE CustomerRef = '${safeCust}' AND TxnDate = '${safeDate}' MAXRESULTS 200`,
  });
  const rows = data?.QueryResponse?.Payment;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
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

async function qbQueryPaymentsByRefNum(app: string | undefined, paymentRefNum: string): Promise<any[]> {
  const safe = escapeQbQueryString(String(paymentRefNum || '').trim());
  if (!safe) return [];
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE PaymentRefNum = '${safe}' MAXRESULTS 200`,
  });
  const rows = data?.QueryResponse?.Payment;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
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
    const exact = await callQbProxy({
      action: 'query',
      entity: 'account',
      app,
      query: `SELECT * FROM Account WHERE Name = '${safe}' MAXRESULTS 1`,
    });
    const exactRows = exact?.QueryResponse?.Account;
    const exactRow = Array.isArray(exactRows) ? exactRows[0] : exactRows;
    if (exactRow?.Id) return String(exactRow.Id);

    // Fallback: some companies have slightly different suffixes, e.g. "DBS Bank" vs "DBS Bank - SGD".
    const like = await callQbProxy({
      action: 'query',
      entity: 'account',
      app,
      query: `SELECT * FROM Account WHERE Name LIKE '${safe.replace(/%/g, '\\%')}%' MAXRESULTS 50`,
    });
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
    const data = await callQbProxy({
      action: 'query',
      entity: 'account',
      app,
      query: `SELECT * FROM Account WHERE AccountType = 'Bank' AND Name LIKE '%${safe.replace(/%/g, '\\%')}%' MAXRESULTS 50`,
    });
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

async function qbReadPayment(app: string | undefined, paymentId: string): Promise<{ id: string; syncToken?: string } | null> {
  const data = await callQbProxy({ action: 'read', entity: 'payment', id: paymentId, app });
  const p = data?.Payment ?? data;
  if (!p?.Id) return null;
  return { id: String(p.Id), syncToken: p?.SyncToken ? String(p.SyncToken) : undefined };
}

async function qbVoidPayment(app: string | undefined, paymentId: string, syncToken: string): Promise<void> {
  await callQbProxy({ action: 'void', entity: 'payment', app, body: { Id: paymentId, SyncToken: syncToken } });
}

async function qbCreatePayment(app: string | undefined, body: any): Promise<{ id: string }> {
  const data = await callQbProxy({ action: 'create', entity: 'payment', app, body });
  const p = data?.Payment ?? data;
  if (!p?.Id) throw new Error('QB payment create returned no Id');
  return { id: String(p.Id) };
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
}): Promise<{
  batchId: string;
  summary: { totalSelected: number; applied: number; skipped: number; failed: number };
  results: Array<{ rowId: string; ok: boolean; status: 'applied' | 'skipped' | 'failed'; error?: string }>;
  enrolmentRollups: { updated: number; results: any[] };
}> {
  await markBatchStatus(input.batchId, 'applying', input.actorUserId);
  await insertGrantImportAuditLog({
    batchId: input.batchId,
    rowId: null,
    eventType: 'apply_start',
    actorUserId: input.actorUserId,
    details: { dryRun: input.dryRun, allowOverwriteAlreadyApplied: input.allowOverwriteAlreadyApplied },
  });

  const rows = await listApplyCandidates(input.batchId);
  const selected = rows.filter((r) => r.selected_for_apply);
  const totalSelected = selected.length;

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ rowId: string; ok: boolean; status: 'applied' | 'skipped' | 'failed'; error?: string }> = [];
  const affectedEnrolments = new Set<string>();
  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || 'app1').trim() || 'app1';

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

      if (match === 'already_applied' && !input.allowOverwriteAlreadyApplied) {
        skipped += 1;
        await updateRowApplyResult({ rowId, applyStatus: 'skipped', applyError: 'Already applied (overwrite not allowed)' });
        await insertGrantImportAuditLog({
          batchId: input.batchId,
          rowId,
          eventType: 'skip',
          actorUserId: input.actorUserId,
          details: { reason: 'already_applied', allowOverwriteAlreadyApplied: false },
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

      const inv = await qbResolveInvoiceForGrantRow({ app: appOverride, grantId, enrolmentId: row.enrolment_id });
      if (!inv?.id) throw new Error(`No QuickBooks invoice found for grant ${grantId} (tried DocNumber, then other GRNs in enrolment)`);
      const customerRef = inv.customerRef;
      if (!customerRef) throw new Error(`QuickBooks invoice ${grantId} has no CustomerRef`);

      // Overwrite behavior: if we previously created a payment for this row, void it first (so we don't double-count).
      if (match === 'already_applied' && input.allowOverwriteAlreadyApplied && row.matched_qb_object_id) {
        try {
          const existing = await qbReadPayment(appOverride, String(row.matched_qb_object_id));
          if (existing?.syncToken) {
            await qbVoidPayment(appOverride, String(row.matched_qb_object_id), String(existing.syncToken));
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
          const candidates = await qbQueryPaymentsByCustomerAndDate(appOverride, customerRef, txnDate);
          const hit = candidates.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, amount));
          if (hit?.Id && hit?.SyncToken) {
            await qbVoidPayment(appOverride, String(hit.Id), String(hit.SyncToken));
          }
        } catch {
          // best-effort
        }
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

      // Business rule: PaymentRefNum should be Bank Reference ID from the disbursement sheet.
      // Fallback to Financial Transaction ID only if Bank Ref is missing.
      const refNum = String(row.bank_reference_id || row.financial_transaction_id || '').trim();
      if (refNum) paymentBody.PaymentRefNum = refNum;

      // Safety: if payment already exists in QB, skip (no QB changes) unless overwrite is enabled.
      // This prevents duplicate payments when QB was updated outside FMS previously.
      if (refNum) {
        // Bank Reference IDs can repeat across multiple invoices.
        // Only treat it as an "existing" duplicate if a payment with this ref is linked to the *same* invoice + amount + date.
        const candidates = await qbQueryPaymentsByRefNum(appOverride, refNum);
        const hit = candidates.find((p: any) => {
          const links = paymentLinksInvoiceAndAmount(p, inv.id, amount);
          const sameDate = String(p?.TxnDate || '').trim() === txnDate;
          return links && sameDate;
        });

        if (hit?.Id) {
          const existingId = String(hit.Id);
          const existingSync = hit.SyncToken ? String(hit.SyncToken) : undefined;

          if (!input.allowOverwriteAlreadyApplied) {
            skipped += 1;
            await updateRowApplyResult({
              rowId,
              applyStatus: 'skipped',
              applyError: `QB payment already exists for this invoice (PaymentRefNum=${refNum}, PaymentId=${existingId})`,
              matchedQbObjectId: existingId,
            });
            await insertGrantImportAuditLog({
              batchId: input.batchId,
              rowId,
              eventType: 'skip',
              actorUserId: input.actorUserId,
              details: {
                reason: 'qb_payment_exists_refnum_linked_invoice_amount_date',
                qb_payment_id: existingId,
                payment_ref_num: refNum,
                qb_invoice_id: inv.id,
                amount,
                payment_date: txnDate,
              },
            });
            results.push({ rowId, ok: true, status: 'skipped' });
            continue;
          }

          // Overwrite allowed → void the matching payment then recreate.
          if (existingSync) {
            try {
              await qbVoidPayment(appOverride, existingId, existingSync);
            } catch {
              // best-effort
            }
          } else {
            try {
              const existing = await qbReadPayment(appOverride, existingId);
              if (existing?.syncToken) await qbVoidPayment(appOverride, existingId, String(existing.syncToken));
            } catch {
              // best-effort
            }
          }
        }
      } else {
        // Fallback safety: detect an existing payment by customer+date linked to invoice+amount.
        // Only applied when we don't have a reliable PaymentRefNum.
        const candidates = await qbQueryPaymentsByCustomerAndDate(appOverride, customerRef, txnDate);
        const hit = candidates.find((p: any) => paymentLinksInvoiceAndAmount(p, inv.id, amount));
        if (hit?.Id) {
          const existingId = String(hit.Id);
          const existingSync = hit.SyncToken ? String(hit.SyncToken) : undefined;

          if (!input.allowOverwriteAlreadyApplied) {
            skipped += 1;
            await updateRowApplyResult({
              rowId,
              applyStatus: 'skipped',
              applyError: `QB payment already exists for this invoice/amount/date (PaymentId=${existingId})`,
              matchedQbObjectId: existingId,
            });
            await insertGrantImportAuditLog({
              batchId: input.batchId,
              rowId,
              eventType: 'skip',
              actorUserId: input.actorUserId,
              details: {
                reason: 'qb_payment_exists_invoice_amount_date',
                qb_payment_id: existingId,
                qb_invoice_id: inv.id,
                amount,
                payment_date: txnDate,
              },
            });
            results.push({ rowId, ok: true, status: 'skipped' });
            continue;
          }

          if (existingSync) {
            try {
              await qbVoidPayment(appOverride, existingId, existingSync);
            } catch {
              // best-effort
            }
          }
        }
      }

      const pm = (process.env.QBO_GRANT_PAYMENT_METHOD_REF || '').trim();
      if (pm) paymentBody.PaymentMethodRef = { value: pm };
      // Business rule: Money deposited to should be DBS Bank (default "DBS Bank - SGD").
      // Resolve by account *name* via QB query (cached), with env id fallback.
      const depName = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_NAME || 'DBS Bank - SGD').trim();
      const depByName =
        (await qbFindAccountIdByName(appOverride, depName).catch(() => null)) ||
        // fallback: some QBO charts omit currency suffix in name
        (depName.toLowerCase().endsWith('- sgd')
          ? await qbFindAccountIdByName(appOverride, depName.replace(/\s*-\s*sgd\s*$/i, '').trim()).catch(() => null)
          : null);
      const depByBankContains =
        depByName ||
        (depName.toLowerCase().includes('dbs') ? await qbFindBankAccountIdByNameContains(appOverride, 'DBS Bank').catch(() => null) : null);
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

      const created = await qbCreatePayment(appOverride, paymentBody);
      if (!created?.id) throw new Error('QuickBooks payment creation returned no Id');

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
          qb_deposit_to_account_name: depName,
          qb_deposit_to_account_id: dep,
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

  // Rollup recalculation only after row applies
  const rollups = await recalcAndPersistGrantPaymentRollups(Array.from(affectedEnrolments), new Date());
  await insertGrantImportAuditLog({
    batchId: input.batchId,
    rowId: null,
    eventType: 'enrolment_status_update',
    actorUserId: input.actorUserId,
    details: { updated: rollups.updated, enrolments: rollups.results },
  });

  await updateBatchCounts(input.batchId);
  await markBatchStatus(input.batchId, 'completed', input.actorUserId);

  return {
    batchId: input.batchId,
    summary: { totalSelected, applied, skipped, failed },
    results,
    enrolmentRollups: rollups,
  };
}

