/**
 * Build + POST a QuickBooks supplier **Bill** for one confirmed trainer payout.
 *
 * This is the payables mirror of the invoice modules in this folder: instead of
 * billing a customer for a course, we record what the Academy owes the trainer
 * who ran it. One class = one bill; nothing is ever consolidated.
 *
 * The shape matches what Finance enters by hand in QBO today:
 *   Supplier      "Trainer <Name>"
 *   Bill no.      the payout's existing TX ref (see lib/payroll/billNo.ts) —
 *                 identical to the "Bill No" shown in the Payout List
 *   Bill date     the class end date
 *   Amounts are   Out of scope of GST
 *   Category      Course & Training   (an expense Account, not an Item)
 *   Description   the course title
 */

import { callQbProxy } from './qbProxyClient';
import { qboQuery, qboResolveOosTaxCodeRef } from '../services/qboInvoiceService';

/** Expense account shown in the bill's "Category" column. */
const EXPENSE_ACCOUNT_NAME = (process.env.QBO_TRAINER_BILL_ACCOUNT_NAME || 'Course & Training').trim();

/**
 * Prefix applied when looking up / creating a trainer's supplier record, so
 * "Sivanesan" resolves to the existing "Trainer Sivanesan" supplier. Set to an
 * empty string for realms that file trainers under their bare name.
 */
const VENDOR_PREFIX =
  process.env.QBO_TRAINER_VENDOR_PREFIX === undefined ? 'Trainer ' : process.env.QBO_TRAINER_VENDOR_PREFIX;

function esc(value: string): string {
  return String(value || '').replace(/'/g, "''");
}

/** QBO "Object Not Found" (error 610) — the object is already gone. */
function isNotFound(message: string): boolean {
  return /object not found|610|not found|does not exist/i.test(message || '');
}

let cachedAccount: { id: string; name: string } | null = null;
let cachedOosTaxCode: string | null = null;
// Trainer name (lowercased) → resolved supplier, so billing a trainer's whole
// month costs one lookup rather than one per class.
const vendorCache = new Map<string, { id: string; name: string }>();

async function findVendorByDisplayName(displayName: string): Promise<{ id: string; name: string } | null> {
  const safe = esc(displayName);
  if (!safe) return null;
  const data = await qboQuery(undefined, `SELECT * FROM Vendor WHERE DisplayName = '${safe}' MAXRESULTS 1`);
  const raw = data?.QueryResponse?.Vendor;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v?.Id) return null;
  return { id: String(v.Id), name: String(v.DisplayName || displayName) };
}

/**
 * Resolve the supplier for a trainer, creating it if neither naming form
 * exists. Tries the prefixed name first ("Trainer Sivanesan") because that's
 * how the realm is organised, then the bare name, so an existing supplier is
 * always reused rather than duplicated.
 */
export async function resolveTrainerVendor(trainerName: string): Promise<{ id: string; name: string }> {
  const bare = String(trainerName || '').trim();
  if (!bare) throw new Error('Cannot resolve a QuickBooks supplier: the payout has no trainer name.');

  const cacheKey = bare.toLowerCase();
  const cached = vendorCache.get(cacheKey);
  if (cached) return cached;

  const prefixed = `${VENDOR_PREFIX}${bare}`.trim();
  const candidates = prefixed === bare ? [bare] : [prefixed, bare];

  for (const name of candidates) {
    const found = await findVendorByDisplayName(name);
    if (found) {
      vendorCache.set(cacheKey, found);
      return found;
    }
  }

  const displayName = prefixed || bare;
  const created = await callQbProxy({
    action: 'create',
    entity: 'vendor',
    body: { DisplayName: displayName, PrintOnCheckName: bare },
  });
  const vendor = created.data?.Vendor;
  if (!vendor?.Id) throw new Error(`QuickBooks supplier create returned no Id for "${displayName}"`);
  console.log(`[QBO trainer bill] Created supplier "${displayName}" (${vendor.Id})`);
  const resolved = { id: String(vendor.Id), name: String(vendor.DisplayName || displayName) };
  vendorCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * The expense account the bill line is categorised under. Unlike suppliers this
 * is NEVER auto-created — chart-of-accounts changes are a finance decision, so
 * a missing account is a hard, actionable error.
 */
async function resolveExpenseAccount(): Promise<{ id: string; name: string }> {
  if (cachedAccount) return cachedAccount;
  const safe = esc(EXPENSE_ACCOUNT_NAME);
  const data = await qboQuery(undefined, `SELECT * FROM Account WHERE Name = '${safe}' MAXRESULTS 1`);
  const raw = data?.QueryResponse?.Account;
  const a = Array.isArray(raw) ? raw[0] : raw;
  if (!a?.Id) {
    throw new Error(
      `QuickBooks account "${EXPENSE_ACCOUNT_NAME}" not found. Create it in QBO (Accounting → Chart of accounts) or set QBO_TRAINER_BILL_ACCOUNT_NAME.`
    );
  }
  cachedAccount = { id: String(a.Id), name: String(a.Name || EXPENSE_ACCOUNT_NAME) };
  return cachedAccount;
}

async function resolveOosTaxCode(): Promise<string | null> {
  if (cachedOosTaxCode !== null) return cachedOosTaxCode;
  try {
    cachedOosTaxCode = await qboResolveOosTaxCodeRef(undefined);
  } catch (e) {
    // Non-GST realms have no tax codes at all — GlobalTaxCalculation alone
    // still produces an out-of-scope bill, so this is not fatal.
    console.warn('[QBO trainer bill] Could not resolve an out-of-scope tax code:', e);
    cachedOosTaxCode = '';
  }
  return cachedOosTaxCode || null;
}

async function findBillsByDocNumber(docNumber: string): Promise<any[]> {
  const safe = esc(docNumber);
  if (!safe) return [];
  const data = await qboQuery(undefined, `SELECT * FROM Bill WHERE DocNumber = '${safe}' MAXRESULTS 20`);
  const raw = data?.QueryResponse?.Bill;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/**
 * Highest sequence already used in QuickBooks for a TX date prefix.
 *
 * Finance has been raising these bills BY HAND for years, so QBO — not our
 * table — is the real record of which numbers are taken. Seeding from here
 * stops a freshly-created trainer_bill table from reissuing TX26061101 when
 * that number is already on a bill somebody typed in last month.
 *
 * Best-effort: returns 0 if QuickBooks can't be reached, and the duplicate
 * guard in createTrainerBill() still catches a clash at post time.
 */
export async function qboMaxBillSequenceForPrefix(prefix: string): Promise<number> {
  const safe = esc(prefix);
  if (!safe) return 0;
  try {
    const data = await qboQuery(
      undefined,
      `SELECT DocNumber FROM Bill WHERE DocNumber LIKE '${safe}%' MAXRESULTS 200`
    );
    const raw = data?.QueryResponse?.Bill;
    const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    let max = 0;
    for (const b of list) {
      const suffix = String(b?.DocNumber || '').slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      max = Math.max(max, parseInt(suffix, 10));
    }
    return max;
  } catch (e) {
    console.warn(`[QBO trainer bill] Could not read existing bill numbers for ${prefix}:`, e);
    return 0;
  }
}

/** Thrown when the allocated bill number is already on somebody else's bill. */
export class BillNumberTakenError extends Error {
  constructor(docNumber: string) {
    super(`Bill number ${docNumber} is already used by a different bill in QuickBooks`);
    this.name = 'BillNumberTakenError';
  }
}

export interface TrainerBillInput {
  billNo: string;
  /** Class end date (YYYY-MM-DD) — used as both bill date and due date. */
  billDate: string;
  trainerName: string;
  /** Course title, printed as the bill line's description. */
  description: string;
  amount: number;
}

export interface PostedTrainerBill {
  qbBillId: string;
  vendorRef: string;
  vendorName: string;
}

export async function createTrainerBill(input: TrainerBillInput): Promise<PostedTrainerBill> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Cannot raise a bill for ${input.trainerName}: payout amount is ${input.amount}.`);
  }

  const vendor = await resolveTrainerVendor(input.trainerName);
  const account = await resolveExpenseAccount();
  const taxCode = await resolveOosTaxCode();

  // Idempotency — recover a bill a previous attempt posted to QBO but failed to
  // record locally (a blip between the POST and the DB update).
  //
  // This must NOT blindly adopt any bill carrying the number. Finance raises
  // these bills by hand and their numbering repeats (TX26061101 sits on three
  // separate bills), so a bare DocNumber match would silently mark a payout as
  // billed against somebody else's document. Only adopt when the supplier AND
  // the amount also match — that is either our own earlier attempt, or a
  // manual bill for this very payout, and adopting beats double-billing.
  const sameNumber = await findBillsByDocNumber(input.billNo);
  if (sameNumber.length > 0) {
    const ours = sameNumber.find(
      (b) =>
        String(b?.VendorRef?.value || '') === vendor.id &&
        Math.abs(Number(b?.TotalAmt ?? NaN) - amount) < 0.005
    );
    if (ours) {
      console.log(`[QBO trainer bill] Reusing existing bill ${ours.Id} (DocNumber ${input.billNo}) — same supplier and amount`);
      return { qbBillId: String(ours.Id), vendorRef: vendor.id, vendorName: vendor.name };
    }
    // Somebody else's bill holds this number — the caller re-allocates.
    throw new BillNumberTakenError(input.billNo);
  }

  const line = (withTax: boolean) => ({
    DetailType: 'AccountBasedExpenseLineDetail',
    Amount: Number(amount.toFixed(2)),
    Description: input.description,
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: account.id, name: account.name },
      ...(withTax && taxCode ? { TaxCodeRef: { value: taxCode } } : {}),
    },
  });

  const body = (withTax: boolean) => ({
    VendorRef: { value: vendor.id, name: vendor.name },
    TxnDate: input.billDate,
    DueDate: input.billDate,
    DocNumber: input.billNo,
    // "Amounts are: Out of scope of GST" in the QBO UI.
    GlobalTaxCalculation: 'NotApplicable',
    Line: [line(withTax)],
  });

  let resp;
  try {
    resp = await callQbProxy({ action: 'create', entity: 'bill', body: body(true) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Realms without GST reject a line-level TaxCodeRef outright. The bill is
    // already out-of-scope via GlobalTaxCalculation, so retry without it.
    if (taxCode && /tax/i.test(msg)) {
      console.warn(`[QBO trainer bill] Retrying ${input.billNo} without a line tax code: ${msg}`);
      resp = await callQbProxy({ action: 'create', entity: 'bill', body: body(false) });
    } else {
      throw e;
    }
  }

  const bill = resp.data?.Bill;
  if (!bill?.Id) throw new Error('QuickBooks bill create returned no Id');

  return { qbBillId: String(bill.Id), vendorRef: vendor.id, vendorName: vendor.name };
}

export interface DeleteBillResult {
  ok: boolean;
  status: 'deleted' | 'not_found' | 'error';
  message: string;
}

/**
 * Remove a bill from QBO when its payout is un-confirmed. Bills have no "void"
 * operation in the QBO API (unlike invoices), so this is a hard delete. The
 * number is not affected: it stays on the payout and is reused if that payout
 * is confirmed again.
 *
 * Never throws; the caller decides how to surface a failure.
 */
export async function deleteTrainerBill(qbBillId: string): Promise<DeleteBillResult> {
  const id = String(qbBillId || '').trim();
  if (!id) return { ok: true, status: 'not_found', message: 'No QuickBooks bill id' };

  try {
    let readData: any;
    try {
      readData = await callQbProxy({ action: 'read', entity: 'bill', id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Bill already gone in QuickBooks' };
      throw e;
    }

    const bill = readData?.data?.Bill;
    if (!bill?.Id) return { ok: true, status: 'not_found', message: 'Bill not found in QuickBooks' };

    await callQbProxy({
      action: 'delete',
      entity: 'bill',
      body: { Id: id, SyncToken: String(bill.SyncToken ?? '0') },
    });
    return { ok: true, status: 'deleted', message: `Deleted bill ${id}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Bill already gone in QuickBooks' };
    return { ok: false, status: 'error', message: msg };
  }
}
