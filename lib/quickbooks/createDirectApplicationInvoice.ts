/**
 * Build + POST a QuickBooks invoice for a Direct Application (net fee after
 * SkillsFuture subsidy and credit).
 */

import pool from '../db';
import { callQbProxy } from './qbProxyClient';
import { buildSfcCreditLineDescription, realApplicationId } from '../daApplicationId';
import { getLocalYMD } from '../dateHelpers';
import { refreshGrantsForEnrolments } from '../services/billingSync';
import { resolveGrantDeductionLinesForInvoice } from '../services/daInvoiceGrantLines';
import {
  buildCourseHeading,
  buildInvoiceLineText,
  COURSE_LINE_HEADING_PREFIX,
  detectFundingFamily,
  resolveFundingItemName,
  type FundingFamily,
  type LineField,
} from './invoiceLineText';
import { formatDateOnlyEnSg } from '../utils/dateOnly';
import { assessGrantEligibility } from '../grantEligibility';
import type { QboItem } from '../services/qboInvoiceService';
import {
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindInvoiceByDocNumberLike,
  qboFindItemByName,
  qboFindItemBySku,
  qboFindTermByName,
  qboGetDefaultInvoiceEmailFields,
  qboReadInvoice,
  qboResolveInvoiceLineTaxCodeRef,
  qboCreateInvoiceRetryingDuplicateDocNumber,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';

/**
 * Fixed QB customer used on every DA main tax invoice. Configurable via env
 * for non-standard realms; defaults to the WSQ Individual bucket. Must exist
 * in QuickBooks as an actual Customer record — we don't auto-create it.
 */
const MAIN_INVOICE_CUSTOMER_NAME = (
  process.env.QBO_DA_MAIN_CUSTOMER_NAME || 'WSQ Individual (Not for Company)'
).trim();

const MAIN_INVOICE_TERM_NAME = 'Due on receipt';

let cachedMainCustomerId: string | null = null;

async function resolveMainInvoiceCustomerRef(): Promise<string> {
  if (cachedMainCustomerId) return cachedMainCustomerId;
  const found = await qboFindCustomerByName(undefined, MAIN_INVOICE_CUSTOMER_NAME);
  if (!found?.id) {
    throw new Error(
      `QuickBooks Customer "${MAIN_INVOICE_CUSTOMER_NAME}" not found. Create it in QBO (Sales → Customers → New customer) or override via QBO_DA_MAIN_CUSTOMER_NAME env var.`
    );
  }
  cachedMainCustomerId = found.id;
  return cachedMainCustomerId;
}

export interface DaApplicationForInvoice {
  id: string;
  trainee_name: string | null;
  trainee_email: string | null;
  trainee_id: string | null;
  /** NRIC / FIN / Foreigner / … — decides whether SSG funding applies at all. */
  trainee_id_type?: string | null;
  course_title: string | null;
  course_reference_number: string | null;
  course_start_date: string | null;
  course_end_date: string | null;
  course_run_id: string | null;
  full_course_fee: string | number | null;
  gst: string | number | null;
  skillsfuture_subsidy: string | number | null;
  skillsfuture_credit: string | number | null;
  grant_id: string | null;
  application_id: string | null;
  qb_customer_ref: string | null;
  // Per-grant breakdown
  bl_grant_id: string | null;
  bl_amount: string | number | null;
  other_grant_id: string | null;
  other_scheme_code: string | null;
  other_amount: string | number | null;
}

export interface CreatedInvoice {
  invoiceId: string;
  docNumber: string;
  customerRef: string;
  netAmount: number;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(d: string | Date | null | undefined): string {
  return formatDateOnlyEnSg(d, '-');
}

/**
 * Mask all but the last 4 characters of an NRIC/FIN for the invoice line
 * description. Example: "T0612345A" -> "XXXXX345A". IDs shorter than 5
 * characters are returned as-is. Falls back to '-' when missing.
 */
function maskNric(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 4) return raw;
  return 'X'.repeat(raw.length - 4) + raw.slice(-4);
}

/** The course date as one field: a single day, or a range. */
function courseDateValue(app: Pick<DaApplicationForInvoice, 'course_start_date' | 'course_end_date'>): string {
  const start = formatDate(app.course_start_date);
  const end = formatDate(app.course_end_date);
  if (start === end || !app.course_end_date) return start;
  return `${start} - ${end}`;
}

/**
 * The per-learner values that fill the blanks in a course product's template.
 *
 * `label` is only a fallback: when the product's own template has a line for the
 * field, that product's wording wins - which is why a CASL invoice reads `Name:`
 * and a WSQ one reads `Participant Name:`.
 */
function courseLineFields(app: DaApplicationForInvoice): LineField[] {
  return [
    { key: 'name', label: 'Participant Name', value: app.trainee_name ?? '-' },
    { key: 'nric', label: 'NRIC', value: maskNric(app.trainee_id) },
    { key: 'date', label: 'Course Date', value: courseDateValue(app) },
    { key: 'run', label: 'Course Run', value: app.course_run_id ?? '-' },
  ];
}

/**
 * The course line, worded by the QuickBooks product.
 *
 * `courseItem` is the product resolved by SKU. Its Description box holds the
 * course title and the blank labels; we fill them in. A product with no usable
 * text falls back to a heading built from the DA row, and says why in the log so
 * the product can be corrected.
 */
export function buildDirectApplicationCourseLine(
  app: DaApplicationForInvoice,
  courseItem: Pick<QboItem, 'name' | 'description'> | null,
  family: FundingFamily
): string {
  const built = buildInvoiceLineText({
    productDescription: courseItem?.description,
    fields: courseLineFields(app),
    fallbackHeading: buildCourseHeading({
      family,
      title: app.course_title,
      courseCode: app.course_reference_number,
    }),
    expectedCode: app.course_reference_number,
    headingPrefix: COURSE_LINE_HEADING_PREFIX,
  });

  if (built.source === 'fallback') {
    console.warn(
      `[DA invoice] Course line built from LMS data for ${app.course_reference_number}: ${built.reason}. ` +
        `Fix the Description on the QuickBooks product to control this wording.`
    );
  }
  return built.text;
}

/**
 * Resolve a QBO product by name, keeping its Description - that text is the
 * line's wording, so a lookup that returns only an id is no longer enough.
 *
 * Falls back to the course product when the named one is missing, exactly as
 * before: a deduction posted against the wrong product is recoverable, a missing
 * deduction line overcharges the learner.
 */
async function resolveLineItem(opts: {
  courseItemRef: { value: string; name?: string };
  courseItem: QboItem | null;
  itemName: string;
}): Promise<{ ref: { value: string; name?: string }; item: Pick<QboItem, 'name' | 'description'> | null }> {
  const targetName = String(opts.itemName || '').trim();
  const fallback = { ref: opts.courseItemRef, item: null };
  if (!targetName) return fallback;

  try {
    const item = await qboFindItemByName(undefined, targetName);
    if (item?.id) {
      return { ref: { value: item.id, name: item.name }, item };
    }
    console.warn(`[QBO] No item found for name: ${targetName}. Falling back to course item.`);
  } catch (e) {
    console.warn(`[QBO] Item lookup failed for name ${targetName}:`, e);
  }

  return fallback;
}

function resolveSkillsFutureCreditItemName(): string {
  return (
    process.env.QBO_SFC_DA_ITEM_NAME ||
    process.env.QBO_SFC_ITEM_NAME ||
    'SkillsFuture Claim by Direct Application'
  ).trim();
}

/**
 * Repair a defect on an invoice QuickBooks already holds. Wording is NOT a
 * defect.
 *
 * This used to restate the course line too, so an invoice re-touched by the
 * nightly sweep silently adopted whatever our code currently said. Once the
 * wording comes from the QuickBooks product that becomes actively wrong: editing
 * a product would rewrite invoices already sent to learners, and a course renewed
 * WSQ -> CASL would retro-relabel every historical invoice for it. An issued
 * invoice keeps the words it was issued with (decision 2026-08-24), so the
 * learner's copy and QuickBooks always agree.
 *
 * What still gets fixed is the one thing that was never legitimate: an SFC line
 * citing `MANUAL-…`, the internal placeholder minted for a manually enrolled
 * learner. That is not an Application ID and must not sit on a tax invoice.
 *
 * Returns the COMPLETE line array to send, or null when nothing needs changing.
 * The whole array is deliberate: a QBO sparse update treats `Line` as the full
 * set and drops any line left out of it, which would silently delete the grant
 * and SFC deduction lines and inflate the balance due.
 */
function repairInvoiceLineDescriptions(
  rawLines: unknown,
  app: DaApplicationForInvoice,
  enrolmentId: string
): any[] | null {
  const existingLines = Array.isArray(rawLines) ? rawLines : [];
  if (existingLines.length === 0) return null;

  const desiredSfcDescription = buildSfcCreditLineDescription(app.application_id, enrolmentId);

  let changed = false;
  const repaired = existingLines.map((line: any) => {
    const description = String(line?.Description ?? '');
    if (!/\bMANUAL-/i.test(description)) return line;
    if (description === desiredSfcDescription) return line;
    changed = true;
    return { ...line, Description: desiredSfcDescription };
  });

  return changed ? repaired : null;
}

/**
 * Bring an invoice QuickBooks already holds back in line with the DA row.
 *
 * Called on the "reusing existing invoice" path so invoices cut before a fix —
 * notably those carrying a `MANUAL-…` placeholder as their Application ID —
 * heal themselves the next time the pipeline touches the row, without cutting a
 * second invoice. A no-op when the descriptions are already correct.
 */
export async function repairDirectApplicationInvoiceDescriptions(
  invoiceId: string,
  app: DaApplicationForInvoice & { enrolment_id?: string }
): Promise<boolean> {
  const invoice = await qboReadInvoice(undefined, invoiceId);
  const repairedLines = repairInvoiceLineDescriptions(
    invoice?.raw?.Line,
    app,
    (app.enrolment_id || '').trim()
  );
  if (!repairedLines || !invoice?.syncToken) return false;

  await qboSparseUpdateInvoice(undefined, invoiceId, invoice.syncToken, { Line: repairedLines });
  return true;
}

/**
 * Serialise invoice creation per enrolment.
 *
 * Three paths can invoice the same learner — the auto-enrol pipeline (including
 * Re-run), the Generate Invoice button, and the nightly sweep — and the invoice
 * number is derived from the enrolment id, so it is identical every time. The
 * idempotency search below is a check-then-act: two overlapping attempts both
 * find nothing, both create, and QuickBooks rejects the second with "Duplicate
 * Document Number". A DA run takes minutes, so that window is wide and the
 * error was routine.
 *
 * Company Applications already guard this with an advisory lock keyed on the
 * group (createCompanyApplicationInvoice); this is the same pattern keyed on the
 * enrolment. The second caller waits, then finds the invoice the first one made
 * and adopts it, which is what the recovery path was doing after the fact.
 *
 * If the lock cannot be taken it FAILS rather than creating anyway — a clear
 * "already being generated" beats a duplicate that has to be reconciled later.
 */
const INVOICE_LOCK_WAIT_MS = 90_000;

export async function createDirectApplicationInvoice(
  app: DaApplicationForInvoice & { enrolment_id?: string }
): Promise<CreatedInvoice> {
  const lockKey = `da-inv:${(app.enrolment_id || '').trim().toLowerCase()}`;
  const client = await pool.connect();
  let held = false;
  try {
    const deadline = Date.now() + INVOICE_LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const res = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [lockKey]);
      if (res.rows[0]?.locked) { held = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!held) {
      throw new Error(
        `An invoice for ${app.enrolment_id} is already being generated by another process. Try again in a moment.`
      );
    }
    return await buildAndPostDirectApplicationInvoice(app);
  } finally {
    if (held) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => {});
    }
    client.release();
  }
}

async function buildAndPostDirectApplicationInvoice(
  app: DaApplicationForInvoice & { enrolment_id?: string }
): Promise<CreatedInvoice> {
  const fullFee = toNumber(app.full_course_fee);
  const gst = toNumber(app.gst);
  const combinedSubsidy = toNumber(app.skillsfuture_subsidy);
  const credit = toNumber(app.skillsfuture_credit);

  const enrolmentId = (app.enrolment_id || '').trim();

  // Refuse to build an invoice from a placeholder enrolment reference.
  // 'MANUAL'/'N/A'/'NA'/'-'/empty are markers for "not yet enrolled with SSG"
  // and must not be allowed into the DocNumber — they collide across learners
  // and produce the TC26-MMDD-MANUAL family of broken invoices.
  if (!/^ENR-/i.test(enrolmentId)) {
    throw new Error(
      `Cannot generate DA invoice: enrolment_id is not a real SSG reference (got "${enrolmentId || 'empty'}"). Enrol the learner with SSG first.`
    );
  }

  if (enrolmentId) {
    try {
      await refreshGrantsForEnrolments([enrolmentId]);
    } catch (e) {
      console.warn('[createDirectApplicationInvoice] Grant refresh (non-blocking):', e);
    }
  }

  // The course product is resolved first because it decides more than the course
  // line: whether this learner's grants bill against the WSQ or the CASL funding
  // products is read from the product's own title, not from our course table, so
  // that a renewal takes effect the moment QuickBooks is right.
  const courseItem = await qboFindItemBySku(undefined, app.course_reference_number || '');
  const itemId = courseItem?.id ?? process.env.QBO_DEFAULT_ITEM_REF ?? null;

  if (!itemId) {
    throw new Error(
      `QBO item not found for SKU: ${app.course_reference_number}. Please create the item in QuickBooks or set QBO_DEFAULT_ITEM_REF.`
    );
  }

  const family: FundingFamily = detectFundingFamily(
    courseItem?.description,
    courseItem?.name,
    app.course_title
  );

  const { lines: grantDeductionLines, totalSubsidy: subsidy } = await resolveGrantDeductionLinesForInvoice({
    enrolmentId: enrolmentId || null,
    combinedSubsidy,
    grantIdFallback: app.grant_id,
    family,
  });

  // Refuse to bill a WSQ learner the full fee because the grant hasn't landed.
  //
  // The grant refresh above is deliberately non-blocking, and an empty
  // `ssg_grants` result is indistinguishable from "not funded" — so a single
  // slow or failed grant issuance used to produce a silently correct-looking
  // invoice at 100% of the fee. That is the worst possible failure here: it
  // overcharges the learner and gets emailed to them, with every step in the
  // pipeline reporting success.
  //
  // Failing instead leaves auto_enrol_status = 'failed', which the sweep
  // retries — so the invoice cuts itself once SSG issues the grant, with no
  // one watching.
  //
  // Deliberately NOT bypassable by `forceInvoice`. That flag is set by the
  // Generate Invoice button, which is a routine bulk action — letting it waive
  // this check would mean an admin clicking through an amber row reintroduces
  // the exact overcharge this guard exists to prevent, silently, on any row in
  // the selection still waiting for its grant. A row that stays amber until
  // the grant lands is the honest signal.
  // Foreigners are the exception the guard must not catch: SSG funds only
  // Citizens and PRs, so for them the full fee IS the correct amount and there
  // is no grant coming to wait for. Only a CONFIDENT 'ineligible' waives the
  // check — an ID we cannot classify stays protected, because guessing wrong
  // here overcharges the learner on an invoice that gets emailed to them.
  const eligibility = assessGrantEligibility({
    nric: app.trainee_id,
    idType: app.trainee_id_type,
  });

  if (grantDeductionLines.length === 0 && subsidy <= 0) {
    if (eligibility.status !== 'ineligible') {
      throw new Error(
        `No SSG grant found for ${enrolmentId} — refusing to invoice the full course fee. ` +
          `SSG may not have issued the grant yet; this row retries automatically once it does.`
      );
    }
    console.log(
      `[DA invoice] ${enrolmentId}: billing the full course fee — ${eligibility.reason}`
    );
  }

  // SkillsFuture Credit offsets what the learner owes and stops there — it is a
  // drawdown against a balance, not a refund, so it can never exceed the amount
  // payable after the grant. The uploaded figure is what the learner HAS, which
  // for a cheap course is often more than the fee; deducting it whole produced a
  // negative invoice and the row failed instead of billing zero.
  //
  // Capping matches every invoice already raised: across the existing records,
  // credit is applied up to the payable amount (GST included) and no further,
  // with several landing exactly on zero.
  const payableBeforeCredit = Number((fullFee - subsidy + gst).toFixed(2));
  const creditApplied = Math.min(credit, Math.max(0, payableBeforeCredit));
  if (creditApplied < credit) {
    console.log(
      `[DA invoice] ${enrolmentId}: SkillsFuture Credit capped at the amount payable — ` +
        `declared ${credit}, applied ${creditApplied} (fee=${fullFee}, gst=${gst}, subsidy=${subsidy})`
    );
  }

  const netAmount = Number((fullFee - subsidy - creditApplied + gst).toFixed(2));

  if (!fullFee || fullFee <= 0) {
    throw new Error(
      `full_course_fee is not set (fee=${fullFee}). Cannot generate invoice for this application.`
    );
  }

  if (!Number.isFinite(netAmount) || netAmount < 0) {
    throw new Error(
      `computed net amount ${netAmount} is not payable (fee=${fullFee}, gst=${gst}, subsidy=${subsidy}, credit=${creditApplied})`
    );
  }

  if (!app.trainee_email) {
    throw new Error('trainee_email is required to create invoice');
  }

  const courseItemRef = { value: itemId, name: courseItem?.name };

  // Customer is always the fixed "WSQ Individual (Not for Company)" bucket
  // — the learner's identity lives in the line-item Description (Participant
  // Name / NRIC / Course Run) rather than on the QB customer card.
  // BillEmail is still set to the learner's address below so QB can email
  // them when sending is enabled.
  const customerRef = await resolveMainInvoiceCustomerRef();

  const txnDate = getLocalYMD(new Date());
  const dueDate = txnDate;

  const last6 = enrolmentId.slice(-6).padStart(6, '0');
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const docNumber = `TC${yy}-${mm}${dd}-${last6}`;

  // Idempotency — recover an orphan main invoice that a previous attempt
  // posted to QBO but failed to persist locally (network blip between POST and
  // DB update). Try today's DocNumber first, then a LIKE search on the stable
  // `-${last6}` suffix so a retry on a later day still matches.

  const mainTerm = await qboFindTermByName(undefined, MAIN_INVOICE_TERM_NAME);
  if (!mainTerm?.id) {
    throw new Error(
      `QuickBooks Term "${MAIN_INVOICE_TERM_NAME}" not found. Create it in QBO (Lists -> All Lists -> Terms).`
    );
  }
  const defaultEmailFields = await qboGetDefaultInvoiceEmailFields(undefined);

  // `ignoreVoided` is what makes reissuing possible. Both searches exist to
  // adopt an invoice a previous attempt created but failed to record; a voided
  // one is not that - it is a document an admin deliberately cancelled, and
  // adopting it would silently point the row back at a zeroed invoice.
  const existingByToday = await qboFindInvoiceByDocNumber(undefined, docNumber, { ignoreVoided: true });
  const existingByLast6 =
    !existingByToday?.id && last6
      ? await qboFindInvoiceByDocNumberLike(undefined, `TC%-${last6}`, { ignoreVoided: true })
      : null;
  const orphan = existingByToday ?? existingByLast6;
  let reusableOrphan = orphan;
  let reusableOrphanInvoice: Awaited<ReturnType<typeof qboReadInvoice>> | null = null;
  if (orphan?.id) {
    try {
      reusableOrphanInvoice = await qboReadInvoice(undefined, orphan.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      if (/\bObject Not Found\b/i.test(message) || /\(code 610\)/i.test(message) || /\berror 610\b/i.test(message)) {
        console.warn(
          `[QBO main invoice] Ignoring stale orphan invoice ${orphan.id} for enrolment ${enrolmentId}; it no longer exists in QBO`
        );
        reusableOrphan = null;
      } else {
        throw err;
      }
    }
  }
  if (reusableOrphan?.id) {
    const reusedDoc = reusableOrphan.raw?.DocNumber ? String(reusableOrphan.raw.DocNumber) : docNumber;
    const currentTermId = reusableOrphan.raw?.SalesTermRef?.value ? String(reusableOrphan.raw.SalesTermRef.value) : '';
    const fieldsToUpdate: Record<string, any> = {
      ...(currentTermId !== mainTerm.id ? { SalesTermRef: { value: mainTerm.id } } : {}),
      ...defaultEmailFields,
    };

    const repairedLines = repairInvoiceLineDescriptions(reusableOrphanInvoice?.raw?.Line, app, enrolmentId);
    if (repairedLines) {
      fieldsToUpdate.Line = repairedLines;
    }

    const reusableSyncToken = reusableOrphanInvoice?.syncToken || reusableOrphan.syncToken;
    if (reusableSyncToken && Object.keys(fieldsToUpdate).length > 0) {
      await qboSparseUpdateInvoice(undefined, reusableOrphan.id, reusableSyncToken, fieldsToUpdate);
    }
    console.log(`[QBO main invoice] Reusing orphan invoice ${reusableOrphan.id} (DocNumber ${reusedDoc}) for enrolment ${enrolmentId}`);
    return {
      invoiceId: String(reusableOrphan.id),
      docNumber: reusedDoc,
      customerRef: reusableOrphan.customerRef || customerRef,
      netAmount,
    };
  }

  const taxGst = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const taxOos = await qboResolveOosTaxCodeRef(undefined);

  const lines: any[] = [];

  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: fullFee,
    Description: buildDirectApplicationCourseLine(app, courseItem, family),
    SalesItemLineDetail: {
      ItemRef: courseItemRef,
      Qty: 1,
      UnitPrice: fullFee,
      TaxCodeRef: { value: taxGst },
    },
  });

  for (const g of grantDeductionLines) {
    const grant = await resolveLineItem({ courseItemRef, courseItem, itemName: g.itemName });
    // `g.description` carries the pre-CASL wording and is now only the fallback;
    // the funding product's own Description box is what prints.
    const built = buildInvoiceLineText({
      productDescription: grant.item?.description,
      fields: [{ key: 'grantRef', label: 'Grant Ref #', value: `1. ${g.grantId}`, block: true }],
      fallbackHeading: g.description.split('\n')[0],
    });
    if (built.source === 'fallback') {
      console.warn(
        `[DA invoice] Funding line built from LMS data for "${g.itemName}": ${built.reason}.`
      );
    }
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: -g.amount,
      Description: built.text,
      SalesItemLineDetail: {
        ItemRef: grant.ref,
        Qty: 1,
        UnitPrice: -g.amount,
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  const sfc = await resolveLineItem({
    courseItemRef,
    courseItem,
    itemName: resolveSkillsFutureCreditItemName(),
  });
  const sfcReference = realApplicationId(app.application_id);
  const sfcBuilt = buildInvoiceLineText({
    productDescription: sfc.item?.description,
    fields: [
      {
        key: 'claim',
        // Without a genuine MySkillsFuture application there is nothing to cite
        // but the SSG enrolment reference - never the internal `MANUAL-` key.
        label: sfcReference ? 'Application ID' : 'Enrolment ID',
        value: sfcReference || enrolmentId,
      },
    ],
    fallbackHeading: 'SkillsFuture Credit Usage/Claim',
  });
  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: -creditApplied,
    Description: sfcBuilt.text,
    SalesItemLineDetail: {
      ItemRef: sfc.ref,
      Qty: 1,
      UnitPrice: -creditApplied,
      TaxCodeRef: { value: taxOos },
    },
  });

  // BillAddr is set to the learner's name on every invoice — the QB Customer
  // is the fixed "WSQ Individual (Not for Company)" bucket, but the printed
  // billing address should identify the actual trainee. Line2–5 are blanked
  // so QBO doesn't merge in stale lines from the customer record.
  //
  // ShipAddr is intentionally blanked — DA invoices have no shipping concept,
  // and QBO will otherwise inherit the customer's default ShipAddr and render
  // a "Shipping to" box on the PDF.
  const billingAddressLine = String(app.trainee_name || '').trim() || MAIN_INVOICE_CUSTOMER_NAME;
  const invoiceBody = {
    CustomerRef: { value: customerRef },
    BillAddr: {
      Line1: billingAddressLine,
      Line2: '',
      Line3: '',
      Line4: '',
      Line5: '',
    },
    ShipAddr: {
      Line1: '',
      Line2: '',
      Line3: '',
      Line4: '',
      Line5: '',
    },
    BillEmail: { Address: app.trainee_email },
    ...defaultEmailFields,
    TxnDate: txnDate,
    DueDate: dueDate,
    SalesTermRef: { value: mainTerm.id },
    GlobalTaxCalculation: 'TaxExcluded',
    Line: lines,
    DocNumber: docNumber,
  };

  console.log('[QBO invoice body]', JSON.stringify(invoiceBody, null, 2));

  // Posts as-is; only a rejected duplicate number costs a second attempt.
  const createResp = await qboCreateInvoiceRetryingDuplicateDocNumber(
    body => callQbProxy({ action: 'create', entity: 'invoice', body }),
    invoiceBody
  );

  const invoice = createResp.data?.Invoice;
  if (!invoice?.Id) {
    throw new Error('QB invoice create returned no Id');
  }

  return {
    invoiceId: String(invoice.Id),
    docNumber: String(invoice.DocNumber || docNumber),
    customerRef,
    netAmount,
  };
}
