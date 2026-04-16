import {
  insertGrantImportAuditLog,
  listApplyCandidates,
  markBatchStatus,
  updateBatchCounts,
  updateRowApplyResult,
} from './grantImportDb';
import { recalcAndPersistGrantPaymentRollups } from './grantImportRollup';

type ProxyResponse<T = any> = { success: boolean; data?: T; error?: string; details?: unknown };

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

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

      const inv = await qbFindInvoiceByDocNumber(appOverride, grantId);
      if (!inv?.id) throw new Error(`No QuickBooks invoice found with DocNumber=${grantId}`);
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

      const refNum = String(row.financial_transaction_id || row.bank_reference_id || '').trim();
      if (refNum) paymentBody.PaymentRefNum = refNum;

      const pm = (process.env.QBO_GRANT_PAYMENT_METHOD_REF || '').trim();
      if (pm) paymentBody.PaymentMethodRef = { value: pm };
      const dep = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_REF || '').trim();
      if (dep) paymentBody.DepositToAccountRef = { value: dep };

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

