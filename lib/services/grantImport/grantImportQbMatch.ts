import pool from '@/lib/db';

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

export function toLineArray(lines: any): any[] {
  return Array.isArray(lines) ? lines : lines ? [lines] : [];
}

/** QB query responses often omit Line/LinkedTxn; reads are full. Use a small $ tolerance. */
const AMT_NEAR = (a: number, b: number) => Math.abs(a - b) < 0.06;

/**
 * True when this payment applies to `invoiceId` for `amount` (line match, sum of lines to that invoice, or single-invoice TotalAmt).
 * More forgiving than strict per-line equality — fixes false "not applied" when QB rounds or records a slightly different line split.
 */
export function paymentMatchesGrantDisbursement(p: any, invoiceId: string, amount: number): boolean {
  const inv = String(invoiceId);
  const target = Number(amount);
  if (!Number.isFinite(target) || target <= 0) return false;

  const lines = toLineArray(p?.Line);
  let sumForInvoice = 0;
  let anyLineToInvoice = false;

  for (const ln of lines) {
    const linked = ln?.LinkedTxn;
    const larr = toLineArray(linked);
    const linksInvoice = larr.some(
      (x: any) => String(x?.TxnType || '') === 'Invoice' && String(x?.TxnId || '') === inv
    );
    if (!linksInvoice) continue;
    anyLineToInvoice = true;
    const a = Number(ln?.Amount);
    if (Number.isFinite(a) && AMT_NEAR(a, target)) return true;
    if (Number.isFinite(a)) sumForInvoice += a;
  }

  if (anyLineToInvoice && sumForInvoice > 0 && AMT_NEAR(sumForInvoice, target)) return true;

  const ta = Number(p?.TotalAmt);
  const linesToInv = lines.filter((ln) => {
    const larr = toLineArray(ln?.LinkedTxn);
    return larr.some((x: any) => String(x?.TxnType || '') === 'Invoice' && String(x?.TxnId || '') === inv);
  });
  if (linesToInv.length === 1 && Number.isFinite(ta) && AMT_NEAR(ta, target)) return true;

  return false;
}

async function qbReadPaymentEntity(app: string | undefined, paymentId: string): Promise<any | null> {
  try {
    const data = await callQbProxy({ action: 'read', entity: 'payment', id: paymentId, app });
    return data?.Payment ?? data ?? null;
  } catch {
    return null;
  }
}

async function qbReadInvoiceEntity(app: string | undefined, invoiceId: string): Promise<any | null> {
  try {
    const data = await callQbProxy({ action: 'read', entity: 'invoice', id: invoiceId, app });
    return data?.Invoice ?? data ?? null;
  } catch {
    return null;
  }
}

/**
 * Query results often omit payment lines; read-by-id before comparing amounts/links.
 */
async function resolvePaymentForMatch(
  app: string | undefined,
  raw: any,
  invoiceId: string,
  amount: number
): Promise<any | null> {
  if (!raw?.Id) return null;
  if (paymentMatchesGrantDisbursement(raw, invoiceId, amount)) return raw;
  const full = await qbReadPaymentEntity(app, String(raw.Id));
  if (full && paymentMatchesGrantDisbursement(full, invoiceId, amount)) return full;
  return null;
}

async function firstMatchingPaymentHydrated(
  app: string | undefined,
  pays: any[],
  invoiceId: string,
  amount: number
): Promise<any | null> {
  for (const raw of pays) {
    const hit = await resolvePaymentForMatch(app, raw, invoiceId, amount);
    if (hit) return hit;
  }
  return null;
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

async function qbQueryPaymentsByCustomerDateWindow(
  app: string | undefined,
  customerRef: string,
  centerIso: string,
  plusMinusDays: number
): Promise<any[]> {
  const safeCust = escapeQbQueryString(String(customerRef || '').trim());
  const d = parseIsoDate(centerIso);
  if (!safeCust || !d) return [];
  const start = new Date(d.getTime());
  start.setUTCDate(start.getUTCDate() - plusMinusDays);
  const end = new Date(d.getTime());
  end.setUTCDate(end.getUTCDate() + plusMinusDays);
  const startIso = fmtIsoDate(start);
  const endIso = fmtIsoDate(end);
  const data = await callQbProxy({
    action: 'query',
    entity: 'payment',
    app,
    query: `SELECT * FROM Payment WHERE CustomerRef = '${safeCust}' AND TxnDate >= '${startIso}' AND TxnDate <= '${endIso}' MAXRESULTS 500`,
  });
  const rows = data?.QueryResponse?.Payment;
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
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

export type QbPaymentLookupResult = {
  paymentId: string;
  existingAmount: number | null;
  existingPaymentDate: string | null;
  app: string;
};

/**
 * Locate an existing QB payment for this import row (invoice + amount), using exact TxnDate, then a date window, then PaymentRefNum.
 */
export async function findQbPaymentDetailsForImportRow(input: {
  grantId: string;
  enrolmentId: string | null;
  paymentDate: string | null;
  amount: number | null;
  bankReferenceId: string | null;
  preferredApp?: string;
}): Promise<QbPaymentLookupResult | null> {
  const grantId = String(input.grantId || '').trim();
  const txnDate = String(input.paymentDate || '').trim();
  const amount = input.amount == null ? NaN : Number(input.amount);
  if (!grantId || !txnDate || !Number.isFinite(amount) || amount <= 0) return null;

  const pref = String(input.preferredApp || (process.env.QBO_GRANT_IMPORT_APP || 'app1')).trim() || 'app1';
  const apps = pref === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
  const bankRef = String(input.bankReferenceId || '').trim();

  for (const app of apps) {
    const inv = await qbResolveInvoiceForGrantRow({
      app,
      grantId,
      enrolmentId: input.enrolmentId,
      paymentDate: txnDate,
    });
    if (!inv?.id) continue;
    let cust = inv.customerRef;
    if (!cust) {
      const fullInv = await qbReadInvoiceEntity(app, inv.id);
      cust = fullInv?.CustomerRef?.value ? String(fullInv.CustomerRef.value) : undefined;
    }
    if (!cust) continue;
    const invoiceId = inv.id;

    let pays = await qbQueryPaymentsByCustomerAndDate(app, cust, txnDate);
    let p = await firstMatchingPaymentHydrated(app, pays, invoiceId, amount);
    if (p?.Id) {
      const totalAmt = Number(p.TotalAmt);
      return {
        paymentId: String(p.Id),
        existingAmount: Number.isFinite(totalAmt) ? totalAmt : null,
        existingPaymentDate: p.TxnDate ? String(p.TxnDate) : null,
        app,
      };
    }

    pays = await qbQueryPaymentsByCustomerDateWindow(app, cust, txnDate, 14);
    p = await firstMatchingPaymentHydrated(app, pays, invoiceId, amount);
    if (p?.Id) {
      const totalAmt2 = Number(p.TotalAmt);
      return {
        paymentId: String(p.Id),
        existingAmount: Number.isFinite(totalAmt2) ? totalAmt2 : null,
        existingPaymentDate: p.TxnDate ? String(p.TxnDate) : null,
        app,
      };
    }

    if (bankRef) {
      const byRef = await qbQueryPaymentsByRefNum(app, bankRef);
      for (const raw of byRef) {
        const hit = await resolvePaymentForMatch(app, raw, invoiceId, amount);
        if (hit?.Id) {
          const totalAmt = Number(hit.TotalAmt);
          return {
            paymentId: String(hit.Id),
            existingAmount: Number.isFinite(totalAmt) ? totalAmt : null,
            existingPaymentDate: hit.TxnDate ? String(hit.TxnDate) : null,
            app,
          };
        }
      }
    }
  }

  // Fallback: invoice not found via DocNumber/description scan, but PaymentRefNum matches — walk linked invoices on the payment.
  if (bankRef) {
    for (const app of apps) {
      const byRef = await qbQueryPaymentsByRefNum(app, bankRef);
      for (const raw of byRef) {
        const full = (await qbReadPaymentEntity(app, String(raw.Id))) || raw;
        if (!full?.Id) continue;
        for (const ln of toLineArray(full.Line)) {
          for (const lt of toLineArray(ln?.LinkedTxn)) {
            if (String(lt?.TxnType || '') !== 'Invoice' || !lt?.TxnId) continue;
            const linkedInvId = String(lt.TxnId);
            const invFull = await qbReadInvoiceEntity(app, linkedInvId);
            if (!invFull) continue;
            const doc = String(invFull.DocNumber || '').trim();
            const descMatch = toLineArray(invFull.Line).some((x: any) => String(x?.Description || '').includes(grantId));
            if (doc !== grantId && !descMatch) continue;
            if (paymentMatchesGrantDisbursement(full, linkedInvId, amount)) {
              const totalAmt = Number(full.TotalAmt);
              return {
                paymentId: String(full.Id),
                existingAmount: Number.isFinite(totalAmt) ? totalAmt : null,
                existingPaymentDate: full.TxnDate ? String(full.TxnDate) : null,
                app,
              };
            }
          }
        }
      }
    }
  }

  return null;
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
