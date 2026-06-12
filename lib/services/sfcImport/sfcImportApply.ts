import pool from '@/lib/db';
import {
  requireSfcImportSchema,
  getSfcImportRowsForApply,
  updateSfcImportRowApplyResult,
  insertSfcImportAuditLog,
  recomputeSfcBatchApplyCounts,
} from './sfcImportDb';
import { createDirectApplicationSfcInvoice } from '@/lib/quickbooks/createDirectApplicationSfcInvoice';

type ProxyResponse<T = any> = { success: boolean; data?: T; error?: string };

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

// Module-level cache: resolved DBS Bank account ID per QB app realm
const _dbsAccountIdCache = new Map<string, Promise<string>>();

async function resolveDbsDepositAccountId(app: string): Promise<string> {
  const cached = _dbsAccountIdCache.get(app);
  if (cached) return cached;

  const p = (async (): Promise<string> => {
    // 1. Try env var shortcut (same vars as grantImportApply)
    const envId = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_REF_DBS || process.env.QBO_GRANT_DEPOSIT_ACCOUNT_REF || '').trim();
    if (envId) return envId;

    // 2. Query QB by account name
    const depName = (process.env.QBO_GRANT_DEPOSIT_ACCOUNT_NAME || 'DBS Bank - SGD').trim();
    const safe = escapeQbQueryString(depName);
    const exact = await callQbProxy({
      action: 'query', entity: 'account', app,
      query: `SELECT * FROM Account WHERE Name = '${safe}' MAXRESULTS 1`,
    });
    const exactRow = Array.isArray(exact?.QueryResponse?.Account)
      ? exact.QueryResponse.Account[0]
      : exact?.QueryResponse?.Account;
    if (exactRow?.Id) return String(exactRow.Id);

    // 3. Partial-name fallback (handles "DBS Bank" vs "DBS Bank - SGD")
    const like = await callQbProxy({
      action: 'query', entity: 'account', app,
      query: `SELECT * FROM Account WHERE AccountType = 'Bank' AND Name LIKE 'DBS%' MAXRESULTS 20`,
    });
    const likeArr: any[] = Array.isArray(like?.QueryResponse?.Account)
      ? like.QueryResponse.Account
      : like?.QueryResponse?.Account ? [like.QueryResponse.Account] : [];
    const found = likeArr.find((a: any) => String(a?.Name || '').toLowerCase().includes('dbs'));
    if (found?.Id) return String(found.Id);

    throw new Error(
      `Could not resolve QuickBooks DBS Bank deposit account. ` +
      `Set env QBO_GRANT_DEPOSIT_ACCOUNT_NAME or QBO_GRANT_DEPOSIT_ACCOUNT_REF_DBS and retry.`
    );
  })().catch((e) => { _dbsAccountIdCache.delete(app); throw e; });

  _dbsAccountIdCache.set(app, p);
  return p;
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

async function qbReadInvoice(app: string, invoiceId: string): Promise<{
  id: string;
  balance: number;
  customerRef: string;
} | null> {
  try {
    const data = await callQbProxy({ action: 'read', entity: 'invoice', id: invoiceId, app });
    const inv = data?.Invoice ?? data;
    if (!inv?.Id) return null;
    return {
      id: String(inv.Id),
      balance: Number(inv.Balance ?? 0),
      customerRef: inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '',
    };
  } catch {
    return null;
  }
}

function toLineArray(lines: any): any[] {
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

async function qbReadPayment(app: string, paymentId: string): Promise<{
  id: string;
  syncToken?: string;
  txnDate?: string;
  paymentRefNum?: string;
  totalAmt?: number;
  unappliedAmt?: number;
  depositToAccountId?: string;
  paymentMethodId?: string;
  lines?: any[];
} | null> {
  const data = await callQbProxy({ action: 'read', entity: 'payment', id: paymentId, app });
  const p = data?.Payment ?? data;
  if (!p?.Id) return null;
  return {
    id: String(p.Id),
    syncToken: p?.SyncToken ? String(p.SyncToken) : undefined,
    txnDate: p?.TxnDate ? String(p.TxnDate) : undefined,
    paymentRefNum: p?.PaymentRefNum ? String(p.PaymentRefNum) : undefined,
    totalAmt: p?.TotalAmt != null ? Number(p.TotalAmt) : undefined,
    unappliedAmt: p?.UnappliedAmt != null ? Number(p.UnappliedAmt) : undefined,
    depositToAccountId: p?.DepositToAccountRef?.value ? String(p.DepositToAccountRef.value) : undefined,
    paymentMethodId: p?.PaymentMethodRef?.value ? String(p.PaymentMethodRef.value) : undefined,
    lines: toLineArray(p?.Line),
  };
}

async function qbVoidPayment(app: string, paymentId: string, syncToken: string): Promise<void> {
  await callQbProxy({ action: 'void', entity: 'payment', app, body: { Id: paymentId, SyncToken: syncToken } });
}

async function qbCreatePayment(app: string, body: any): Promise<{ id: string }> {
  const data = await callQbProxy({ action: 'create', entity: 'payment', app, body });
  const p = data?.Payment ?? data;
  if (!p?.Id) throw new Error('QB payment create returned no Id');
  return { id: String(p.Id) };
}

function paymentLinksInvoice(p: any, invoiceId: string): boolean {
  for (const ln of toLineArray(p?.lines ?? p?.Line)) {
    const larr = toLineArray(ln?.LinkedTxn);
    if (larr.some((x: any) => String(x?.TxnType || '') === 'Invoice' && String(x?.TxnId || '') === String(invoiceId))) {
      return true;
    }
  }
  return false;
}

async function qbQueryPaymentsByRefNum(app: string, refNum: string): Promise<any[]> {
  const safe = escapeQbQueryString(String(refNum || '').trim());
  if (!safe) return [];
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE PaymentRefNum = '${safe}' MAXRESULTS 10`,
  });
  const rows = data?.QueryResponse?.Payment;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

export async function applySfcImportRows(input: {
  batchId: number;
  rowIds: number[];
  actorUserId: string | null;
}): Promise<{
  summary: { totalSelected: number; applied: number; skipped: number; failed: number };
  results: Array<{ rowId: number; status: 'applied' | 'skipped' | 'failed'; error?: string }>;
}> {
  await requireSfcImportSchema();

  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || process.env.QUICKBOOKS_DEFAULT_APP || 'app1').trim() || 'app1';
  const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];

  const rows = await getSfcImportRowsForApply(input.batchId, input.rowIds);
  const totalSelected = rows.length;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ rowId: number; status: 'applied' | 'skipped' | 'failed'; error?: string }> = [];

  for (const row of rows) {
    const rowId = Number(row.id);

    try {
      const matchStatus = String(row.match_status || '');
      const applyStatus = String(row.apply_status || '');
      const syncOnly = applyStatus === 'applied' || matchStatus === 'already_applied';

      // Step 1 — Safety checks
      if (['invalid', 'unmatched', 'skipped_da'].includes(matchStatus)) {
        skipped++;
        await updateSfcImportRowApplyResult({ rowId, applyStatus: 'skipped', applyError: `Not applicable: match_status=${matchStatus}` });
        await insertSfcImportAuditLog({ batchId: input.batchId, rowId, event: 'skip', details: { reason: 'not_applicable', match_status: matchStatus } });
        results.push({ rowId, status: 'skipped' });
        continue;
      }

      // NOTE: We intentionally do NOT early-return for apply_status='applied' or match_status='already_applied'.
      // We still want to re-check QB and sync FMS status, but we will avoid creating new payments (syncOnly=true).

      const claimId = String(row.claim_id || '').trim();
      const claimAmount = Number(row.claim_amount);
      const txnDate = String(row.disbursement_date_iso || '').trim();
      const payoutRequestId = String(row.payout_request_id || '').trim();
      const isDa = !!String(row.da_application_id || '').trim();
      const daApplicationId = String(row.da_application_id || '').trim() || null;
      const daSfcInvoiceId = String(row.da_sfc_invoice_id || '').trim() || null;
      const mainQboDocNumber = String(row.main_qbo_doc_number || '').trim() || null;

      let qboInvoiceId = String(row.matched_qbo_invoice_id || '').trim() || daSfcInvoiceId || '';
      const enrolmentId = String(row.matched_enrolment_id || '').trim();
      const ssgClaimId = String(row.matched_ssg_claim_id || '').trim();

      if (!claimId) throw new Error('Missing claim_id');
      if (!Number.isFinite(claimAmount) || claimAmount <= 0) throw new Error('Invalid claim_amount');
      if (!txnDate) throw new Error('Missing disbursement_date_iso');
      if (!payoutRequestId) throw new Error('Missing payout_request_id');

      // DA rows: if the supplemental SFC invoice doesn't exist yet, create it now (only when we're actually applying).
      if (!qboInvoiceId && isDa && !syncOnly) {
        if (!enrolmentId) throw new Error('Missing matched_enrolment_id (required for DA)');
        if (!daApplicationId) throw new Error('Missing da_application_id (required for DA)');

        const created = await createDirectApplicationSfcInvoice({
          enrolmentId,
          mainInvoiceDocNumber: mainQboDocNumber,
          sfcClaimId: claimId,
          applicationId: daApplicationId,
          fallbackAmount: claimAmount,
        });
        if (!created?.invoiceId) throw new Error('Failed to create DA SFC invoice in QuickBooks');

        qboInvoiceId = String(created.invoiceId);

        // Persist linkage for future runs (best-effort).
        try {
          await pool.query(
            `UPDATE public.da_application
             SET sfc_invoice_id = $2::varchar
             WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))`,
            [enrolmentId, created.invoiceId]
          );
        } catch {
          // best-effort
        }

        await pool.query(
          `UPDATE public.sfc_import_rows SET
             da_sfc_invoice_id = $2::varchar,
             matched_qbo_invoice_id = $2::varchar,
             matched_qbo_doc_number = $3::varchar
           WHERE id = $1::int`,
          [rowId, created.invoiceId, created.docNumber ?? null]
        );
      }

      // For already-applied rows with no invoice ID stored, we can't re-check QB — just skip cleanly.
      if (!qboInvoiceId) {
        if (syncOnly) {
          skipped++;
          await updateSfcImportRowApplyResult({ rowId, applyStatus: 'skipped', applyError: 'Already applied — no QB invoice ID stored to re-verify' });
          results.push({ rowId, status: 'skipped' });
          continue;
        }
        throw new Error('Missing matched_qbo_invoice_id');
      }

      // Step 2 — Re-fetch QB invoice balance
      let resolvedApp: string | null = null;
      let invoiceCustomerRef: string | null = null;
      let invoiceBalanceBefore: number | null = null;
      for (const app of apps) {
        const inv = await qbReadInvoice(app, qboInvoiceId);
        if (inv !== null) {
          resolvedApp = app;
          invoiceCustomerRef = inv.customerRef;
          invoiceBalanceBefore = inv.balance;
          if (inv.balance === 0) {
            skipped++;
            const alreadyPaidRemark = 'Invoice already fully paid in QB — SFC payment not applied';
            await updateSfcImportRowApplyResult({ rowId, applyStatus: 'skipped', applyError: alreadyPaidRemark });
            await pool.query(
              `UPDATE public.sfc_import_rows SET match_status = 'already_applied' WHERE id = $1`,
              [rowId]
            );
            await pool.query(
              `UPDATE public.invoice_jobs SET qbo_sfc_status = 'Paid' WHERE enrolment_id = $1`,
              [enrolmentId]
            );
            // Sync FMS claim status too (QB is paid, so FMS should reflect Paid even if this row was never applied via FMS).
            // Best-effort: if we can locate a QB payment by payoutRequestId, store qb_payment_id; otherwise keep existing.
            try {
              let qbPaymentId: string | null = null;
              if (payoutRequestId) {
                const existing = await qbQueryPaymentsByRefNum(app, payoutRequestId);
                const hit = existing.find((p: any) => paymentLinksInvoice(p, qboInvoiceId));
                if (hit?.Id) qbPaymentId = String(hit.Id);
              }
              if (ssgClaimId) {
                await pool.query(
                  `UPDATE public.ssg_claims
                   SET claim_payment_status = 'PAID',
                       payment_date = $1::date,
                       qb_payment_id = COALESCE($2::varchar, qb_payment_id),
                       last_sfc_import_at = NOW()
                   WHERE id = $3::uuid`,
                  [txnDate, qbPaymentId, ssgClaimId]
                );
              }
            } catch {
              // non-blocking
            }
            await insertSfcImportAuditLog({
              batchId: input.batchId, rowId, event: 'already_paid',
              details: { qbo_invoice_id: qboInvoiceId, app, remark: alreadyPaidRemark },
            });
            results.push({ rowId, status: 'skipped' });
            break;
          }
          break;
        }
      }

      if (!resolvedApp || !invoiceCustomerRef) {
        throw new Error(`QB invoice ${qboInvoiceId} not found in any app realm`);
      }

      // Check if results already pushed (invoice fully paid)
      if (results.some((r) => r.rowId === rowId)) continue;

      // Idempotency: check if QB already has a payment for this ref num linked to this invoice
      if (payoutRequestId) {
        const existing = await qbQueryPaymentsByRefNum(resolvedApp, payoutRequestId);
        const hit = existing.find((p: any) => paymentLinksInvoice(p, qboInvoiceId));
        if (hit?.Id) {
          const qbPaymentId = String(hit.Id);
          if (syncOnly) {
            skipped++;
            await updateSfcImportRowApplyResult({ rowId, applyStatus: 'skipped', applyError: 'Already paid in QB (synced to FMS)', matchedQbPaymentId: qbPaymentId });
          } else {
            applied++;
            await updateSfcImportRowApplyResult({ rowId, applyStatus: 'applied', applyError: null, matchedQbPaymentId: qbPaymentId });
          }
          await pool.query(
            `UPDATE public.ssg_claims SET claim_payment_status = 'PAID', payment_date = $1::date, qb_payment_id = $2::varchar, last_sfc_import_at = NOW() WHERE id = $3::uuid`,
            [txnDate, qbPaymentId, ssgClaimId]
          );
          if (enrolmentId) {
            await pool.query(
              `UPDATE public.invoice_jobs SET qbo_sfc_status = 'Paid' WHERE enrolment_id = $1`,
              [enrolmentId]
            );
          }
          await insertSfcImportAuditLog({ batchId: input.batchId, rowId, event: 'apply_success', details: { reason: 'existing_payment_found_by_ref', qb_payment_id: qbPaymentId, app: resolvedApp } });
          results.push({ rowId, status: syncOnly ? 'skipped' : 'applied' });
          continue;
        }

        // NOTE: payout_request_id is batch-level — one ID is shared by all claims in the same
        // TPGateway payout. We must NOT void other payments with this RefNum since they may be
        // correctly-applied payments for other claims in the same batch.
      }

      // Step 3 — Two-step QB Payment Creation
      if (syncOnly) {
        skipped++;
        const msg = applyStatus === 'applied'
          ? 'Already applied in FMS (sync check complete)'
          : 'Already applied (sync check complete)';
        await updateSfcImportRowApplyResult({ rowId, applyStatus: 'skipped', applyError: msg });
        await insertSfcImportAuditLog({ batchId: input.batchId, rowId, event: 'skip', details: { reason: 'sync_only', apply_status: applyStatus, match_status: matchStatus } });
        results.push({ rowId, status: 'skipped' });
        continue;
      }

      // Use the invoice's own CustomerRef for the bare payment.
      // Mismatching customer between the bare payment and the LinkedTxn update causes QB to
      // silently accept the POST but not apply the payment to the invoice.
      const bareCustomerRef = invoiceCustomerRef || '1405';

      // Step 3a — Create bare payment (no Line) to get a stable Id
      const created = await qbCreatePayment(resolvedApp, {
        CustomerRef: { value: bareCustomerRef },
        TotalAmt: Number(claimAmount.toFixed(2)),
        TxnDate: txnDate,
      });

      // Step 3b — Read payment back for fresh SyncToken and UnappliedAmt
      const fetched = await qbReadPayment(resolvedApp, created.id);
      if (!fetched || !fetched.syncToken) {
        throw new Error(`Could not read back SyncToken for payment ${created.id} — manual cleanup may be required in QB`);
      }
      const unappliedAmt = fetched.unappliedAmt ?? Number(claimAmount.toFixed(2));

      // Step 3c — Update payment to link the invoice (POST with Id = update in QB)
      const dbsDepositAccountId = await resolveDbsDepositAccountId(resolvedApp);
      await qbCreatePayment(resolvedApp, {
        Id: created.id,
        SyncToken: fetched.syncToken,
        CustomerRef: { value: invoiceCustomerRef },
        TotalAmt: unappliedAmt,
        TxnDate: txnDate,
        PaymentRefNum: payoutRequestId,
        PaymentMethodRef: { value: '7' },
        DepositToAccountRef: { value: dbsDepositAccountId },
        Line: [
          {
            Amount: unappliedAmt,
            LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }],
          },
        ],
      });

      // Step 3d — Re-fetch invoice to verify new balance
      const invoiceAfter = await qbReadInvoice(resolvedApp, qboInvoiceId);
      const newBalance = invoiceAfter?.balance ?? null;

      // If the invoice balance did not decrease, the payment was not applied — fail the row so
      // the user sees a clear error rather than a false "applied" that hides the orphaned payment.
      if (
        invoiceBalanceBefore !== null &&
        newBalance !== null &&
        newBalance >= invoiceBalanceBefore
      ) {
        throw new Error(
          `QB payment ${created.id} was created but invoice ${qboInvoiceId} balance did not decrease ` +
          `(before: $${invoiceBalanceBefore.toFixed(2)}, after: $${newBalance.toFixed(2)}). ` +
          `The payment may be orphaned in QB — void or delete payment RefNum '${payoutRequestId}' manually before retrying.`
        );
      }

      const sfcStatus = newBalance === 0 ? 'Paid' : 'Unpaid';

      // Step 4 — Update ssg_claims
      await updateSfcImportRowApplyResult({ rowId, applyStatus: 'applied', applyError: null, matchedQbPaymentId: created.id });
      await pool.query(
        `UPDATE public.ssg_claims SET claim_payment_status = 'PAID', payment_date = $1::date, qb_payment_id = $2::varchar, last_sfc_import_at = NOW() WHERE id = $3::uuid`,
        [txnDate, created.id, ssgClaimId]
      );

      // Step 5 — Update invoice_jobs.qbo_sfc_status
      if (enrolmentId) {
        await pool.query(
          `UPDATE public.invoice_jobs SET qbo_sfc_status = $1 WHERE enrolment_id = $2`,
          [sfcStatus, enrolmentId]
        );

        // Step 6 — Personal data masking when all three invoice statuses are Paid
        if (sfcStatus === 'Paid') {
          const ijRow = await pool.query(
            `SELECT qbo_tg_status, qbo_net_fee_status FROM public.invoice_jobs WHERE enrolment_id = $1 LIMIT 1`,
            [enrolmentId]
          );
          const ij = ijRow.rows[0];
          if (ij?.qbo_tg_status === 'Paid' && ij?.qbo_net_fee_status === 'Paid') {
            await pool.query(
              `UPDATE public.ssg_enrolments
               SET
                 trainee_nric = CASE
                   WHEN trainee_nric IS NOT NULL AND LENGTH(trainee_nric) > 4
                   THEN REPEAT('x', LENGTH(trainee_nric) - 4) || RIGHT(trainee_nric, 4)
                   ELSE trainee_nric
                 END,
                 raw_data = CASE
                   WHEN raw_data IS NOT NULL
                   THEN jsonb_set(
                     jsonb_set(
                       raw_data,
                       '{trainee,contactNumber,phoneNumber}',
                       CASE
                         WHEN raw_data->'trainee'->'contactNumber'->>'phoneNumber' IS NOT NULL
                         THEN to_jsonb('xxxx' || RIGHT(raw_data->'trainee'->'contactNumber'->>'phoneNumber', 4))
                         ELSE raw_data->'trainee'->'contactNumber'->'phoneNumber'
                       END
                     ),
                     '{trainee,dateOfBirth}',
                     CASE
                       WHEN raw_data->'trainee'->>'dateOfBirth' IS NOT NULL
                       THEN to_jsonb(LEFT(raw_data->'trainee'->>'dateOfBirth', 4) || '-xx-xx')
                       ELSE raw_data->'trainee'->'dateOfBirth'
                     END
                   )
                   ELSE raw_data
                 END,
                 personal_data_masked = TRUE
               WHERE enrolment_id = $1
                 AND personal_data_masked = FALSE`,
              [enrolmentId]
            );
            await insertSfcImportAuditLog({
              batchId: input.batchId, rowId, event: 'personal_data_masked',
              details: { enrolment_id: enrolmentId, reason: 'all_three_invoices_paid' },
            });
          }
        }
      }

      // Step 7 — Audit log
      await insertSfcImportAuditLog({
        batchId: input.batchId,
        rowId,
        event: 'apply_success',
        details: {
          claim_id: claimId,
          enrolment_id: enrolmentId,
          qb_invoice_id: qboInvoiceId,
          qb_payment_id: created.id,
          app: resolvedApp,
          amount: claimAmount,
          txn_date: txnDate,
          payout_request_id: payoutRequestId,
          new_invoice_balance: newBalance,
          qbo_sfc_status: sfcStatus,
        },
      });

      applied++;
      results.push({ rowId, status: 'applied' });
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : 'Apply failed';
      await updateSfcImportRowApplyResult({ rowId, applyStatus: 'failed', applyError: msg });
      await insertSfcImportAuditLog({ batchId: input.batchId, rowId, event: 'apply_fail', details: { error: msg } });
      results.push({ rowId, status: 'failed', error: msg });
    }
  }

  // Step 7 — Update batch counters
  await recomputeSfcBatchApplyCounts(input.batchId);

  return { summary: { totalSelected, applied, skipped, failed }, results };
}
