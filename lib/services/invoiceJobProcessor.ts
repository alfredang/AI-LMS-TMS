import pool from '../db';
import { assessGrantEligibility } from '../grantEligibility';
import { realApplicationId } from '../daApplicationId';
import { buildTmsInvoiceNo } from '../utils/tmsInvoiceNo';
import { isEnrolmentBlockedFromAutoInvoice, isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';
import { refreshGrantsForEnrolments, upsertSsgEnrolmentFromLocalEnrollment } from './billingSync';
import { uploadInvoicePdfToDrive } from './invoiceDriveUpload';
import { resolveGrantDeductionLinesForInvoice } from './daInvoiceGrantLines';
import {
  buildCourseHeading,
  buildInvoiceLineText,
  COURSE_LINE_HEADING_PREFIX,
  detectFundingFamily,
  type FundingFamily,
  type LineField,
} from '../quickbooks/invoiceLineText';
import { formatDateOnlyEnSg } from '../utils/dateOnly';
import {
  qboCreateInvoice,
  qboFetchInvoicePdf,
  qboFindCustomerByDisplayName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboFindItemBySku,
  qboFindOrCreateCustomerByDisplayName,
  qboFindTermByName,
  qboGetDefaultInvoiceEmailFields,
  qboReadInvoice,
  qboResolveInvoiceLineTaxCodeRef,
  qboResolveOosTaxCodeRef,
  qboSendInvoice,
} from './qboInvoiceService';
import { shouldSendQboInvoiceEmailFromQuickBooks } from './qboInvoiceEmailPolicy';
import { getLocalYMD } from '../dateHelpers';

// QB items are cached at module level so subsequent invoice jobs don't re-query
// QuickBooks. Item NAMES vary by the enrolment's course type ("WSQ Funding
// (Baseline)", "CASL Funding (MCES/SME)", ...), so the cache is keyed by name.
//
// Entries also carry the product's Description, which is the WORDING that prints
// on the invoice — so unlike an id, it is something an admin edits and expects to
// see take effect. A cache with no expiry would hold a corrected typo until the
// container restarted, so entries are short-lived.
const ITEM_CACHE_TTL_MS = Math.max(60_000, Number(process.env.QBO_ITEM_CACHE_TTL_MS) || 10 * 60_000);

type CachedItem = { id: string; name: string; unitPrice: number; description: string | null; at: number };
const _grantItemCache = new Map<string, CachedItem>();
const _skuItemCache = new Map<string, CachedItem>();

function readItemCache(cache: Map<string, CachedItem>, key: string): CachedItem | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ITEM_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function writeItemCache(
  cache: Map<string, CachedItem>,
  key: string,
  item: { id: string; name: string; unitPrice?: number; description?: string | null }
): void {
  if (cache.size > 200) cache.clear();
  cache.set(key, {
    id: item.id,
    name: item.name,
    unitPrice: Number(item.unitPrice ?? 0),
    description: item.description ?? null,
    at: Date.now(),
  });
}
let _cachedWsqiCustomerId: string | null = null;
let _cachedTaxCodeGst: string | null = null;
let _cachedTaxCodeOos: string | null = null;
/**
 * The Product/Service the SkillsFuture Credit deduction posts against. Same
 * default and env overrides as the DA pipeline so the two cannot diverge.
 */
const SFC_ITEM_NAME = (
  process.env.QBO_SFC_DA_ITEM_NAME ||
  process.env.QBO_SFC_ITEM_NAME ||
  'SkillsFuture Claim by Direct Application'
).trim();
let _cachedDueOnReceiptTermId: string | null = null;
let _cachedWsg35DaysTermId: string | null = null;

function addDaysIso(isoDate: string, days: number): string {
  const m = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

// Course-title prefixing now lives in buildCourseHeading (invoiceLineText.ts),
// shared with the DA path, and only runs when a product has no Description of
// its own to take the title from. Its strip-then-apply behaviour came from the
// withCourseTypePrefix() helper that used to sit here.

function maskNric(nric: string | null | undefined): string {
  const s = String(nric || '').trim();
  if (!s || s === '—') return '—';
  return s.length > 4 ? 'XXXXX' + s.slice(-4) : s;
}

function formatDate(d: string | Date | null | undefined): string {
  return formatDateOnlyEnSg(d, '-');
}

type InvoiceContext = {
  courseTitle: string;
  courseRef: string;
  runId: string;
  startDate: string | null;
  endDate: string | null;
  traineeName: string;
  traineeNric: string | null;
  feeExGst: number;
  sfcAmount: number;
  sfcClaimId: string | null;
};

async function loadInvoiceContext(
  enrolmentId: string,
  userId: string,
  learnerEmail: string,
  courseCodeFallback: string
): Promise<InvoiceContext> {
  const [seRes, enrRes, sfcRes] = await Promise.all([
    pool.query(
      `SELECT trainee_name, trainee_nric, course_title, course_reference, course_run_id, raw_data
       FROM ssg_enrolments
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))
       LIMIT 1`,
      [enrolmentId]
    ),
    pool.query(
      `SELECT
         c.title AS course_title,
         c.course_code AS course_code,
         c.course_fees_exclude_gst,
         cr.course_run_id::text AS course_run_id,
         cr.start_date::text AS start_date,
         cr.end_date::text AS end_date,
         u.full_name AS full_name,
         COALESCE(lp.nric::text, e.nric::text) AS trainee_nric
       FROM enrollment e
       JOIN course c ON c.id = e.course_id
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN app_user u ON u.id = e.user_id
       LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
       WHERE e.user_id = $1::uuid
         AND LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM($2::text))
       LIMIT 1`,
      [userId, enrolmentId]
    ),
    pool.query(
      `SELECT claim_id, claim_amount
       FROM ssg_claims
       WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))
       ORDER BY claim_id DESC
       LIMIT 1`,
      [enrolmentId]
    ),
  ]);

  const se = seRes.rows[0] as any;
  const raw = (se?.raw_data ?? {}) as any;
  const trainee = raw?.trainee ?? {};
  const course = raw?.course ?? {};
  const run = course?.run ?? {};

  const enr = enrRes.rows[0] as any;

  const courseTitle =
    String(se?.course_title || '').trim() ||
    String(course?.title || '').trim() ||
    String(enr?.course_title || '').trim() ||
    courseCodeFallback;
  const courseRef =
    String(se?.course_reference || '').trim() ||
    String(course?.referenceNumber || '').trim() ||
    String(enr?.course_code || '').trim() ||
    courseCodeFallback;
  const runId =
    String(se?.course_run_id || '').trim() ||
    String(run?.id || '').trim() ||
    String(enr?.course_run_id || '').trim() ||
    '—';

  const startDate =
    (typeof run?.startDate === 'string' && run.startDate.trim())
      ? run.startDate.trim()
      : (typeof enr?.start_date === 'string' && enr.start_date.trim())
        ? enr.start_date.trim()
        : null;
  const endDate =
    (typeof run?.endDate === 'string' && run.endDate.trim())
      ? run.endDate.trim()
      : (typeof enr?.end_date === 'string' && enr.end_date.trim())
        ? enr.end_date.trim()
        : null;

  const traineeName =
    String(se?.trainee_name || '').trim() ||
    String(trainee?.fullName || '').trim() ||
    String(enr?.full_name || '').trim() ||
    (await getLearnerDisplayName(userId, learnerEmail));
  const traineeNric =
    String(se?.trainee_nric || '').trim() ||
    String(trainee?.id || '').trim() ||
    String(enr?.trainee_nric || '').trim() ||
    null;

  const feeExGst = Number(enr?.course_fees_exclude_gst) || 0;

  const sfcRow = sfcRes.rows[0] as any;
  const sfcAmount = Number(sfcRow?.claim_amount) || 0;
  const sfcClaimId = sfcRow?.claim_id ? String(sfcRow.claim_id) : null;

  return {
    courseTitle,
    courseRef,
    runId,
    startDate,
    endDate,
    traineeName,
    traineeNric: traineeNric || null,
    feeExGst,
    sfcAmount,
    sfcClaimId,
  };
}

async function step<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const inner = e instanceof Error ? e.message : String(e);
    throw new Error(`${phase}: ${inner}`);
  }
}

async function getLearnerDisplayName(userId: string, fallbackEmail: string): Promise<string> {
  const r = await pool.query(`SELECT full_name FROM app_user WHERE id = $1 LIMIT 1`, [userId]);
  return (r.rows[0]?.full_name || '').trim() || fallbackEmail;
}

async function reserveTmsInvoiceNo(jobId: string, enrolmentId: string, existing: string | null | undefined): Promise<string> {
  const trimmed = (existing || '').trim();
  if (trimmed) return trimmed;
  const now = new Date();
  for (let salt = 0; salt < 100; salt++) {
    const candidate = buildTmsInvoiceNo(enrolmentId, now, salt);
    const taken = await pool.query(
      `SELECT 1 FROM public.invoice_jobs WHERE invoice_no = $1 AND id <> $2::uuid LIMIT 1`,
      [candidate, jobId]
    );
    if (taken.rows.length > 0) continue;
    try {
      await pool.query(
        `UPDATE public.invoice_jobs SET invoice_no = $1, updated_at = now() WHERE id = $2::uuid`,
        [candidate, jobId]
      );
      return candidate;
    } catch (e: unknown) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === '23505') continue;
      throw e;
    }
  }
  throw new Error('Could not allocate unique TMS invoice number');
}

export async function processInvoiceJob(jobId: string): Promise<void> {
  // Load job
  const jobRes = await pool.query(`SELECT * FROM public.invoice_jobs WHERE id = $1 LIMIT 1`, [jobId]);
  const job = jobRes.rows[0];
  if (!job) throw new Error('Job not found');
  if (job.status === 'done') return;

  const enrolmentId: string = job.enrolment_id;
  const userId: string = job.user_id;
  const learnerEmail: string = job.learner_email;
  const courseCode: string = job.course_code;

  // Fetch all needed fields from da_application
  const daRes = await pool.query(
    `SELECT full_course_fee, gst, skillsfuture_subsidy, skillsfuture_credit,
            course_title, course_reference_number, course_start_date, course_end_date,
            trainee_name, trainee_id, trainee_id_type, course_run_id, grant_id,
            skillsfuture_credit_claim_id, application_id
     FROM da_application WHERE enrolment_id = $1 LIMIT 1`,
    [enrolmentId]
  );
  const da = daRes.rows[0] || {};

  const hasDa = daRes.rows.length > 0;
  const fullCourseFee = Number(da.full_course_fee) || 0;
  const combinedSubsidy = Number(da.skillsfuture_subsidy) || 0;
  const sfcCreditDa = Number(da.skillsfuture_credit) || 0;

  console.log('[invoice-job] DA values', {
    enrolmentId,
    hasDa,
    full_course_fee: da.full_course_fee,
    skillsfuture_subsidy: da.skillsfuture_subsidy,
    skillsfuture_credit: da.skillsfuture_credit,
    course_title: da.course_title,
    trainee_name: da.trainee_name,
    grant_id: da.grant_id,
    application_id: da.application_id,
  });

  const enrRow = await pool.query(
    `SELECT enrolment_status FROM enrollment
     WHERE user_id = $1 AND LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($2::text))
     LIMIT 1`,
    [userId, enrolmentId]
  );
  const enrStatus = enrRow.rows[0]?.enrolment_status as string | undefined;

  const ssgStatusRow = await pool.query(
    `SELECT enrolment_status FROM ssg_enrolments
     WHERE LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($1::text))
     LIMIT 1`,
    [enrolmentId]
  );
  const ssgStatus = ssgStatusRow.rows[0]?.enrolment_status as string | undefined;

  // Course type (WSQ / CASL / IBF / Non-WSQ) decides the "<TYPE> - <title>" description
  // prefix and the "<TYPE> funding (...)" QB item/description below — must be resolved
  // before the grant deduction lines, since it feeds their QB item name. DA rows keep the
  // historical hardcoded "WSQ" (da_application has no course_type of its own).
  let courseTypeLabel = 'WSQ';
  if (!hasDa) {
    const courseTypeRow = await pool.query(
      `SELECT c.course_type::text AS course_type
       FROM enrollment e
       JOIN course c ON c.id = e.course_id
       WHERE e.user_id = $1::uuid
         AND LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM($2::text))
       LIMIT 1`,
      [userId, enrolmentId]
    );
    courseTypeLabel = String(courseTypeRow.rows[0]?.course_type || '').trim() || 'WSQ';
  }

  if (isEnrolmentBlockedFromAutoInvoice(enrStatus) || isEnrolmentBlockedFromAutoInvoice(ssgStatus)) {
    throw new Error('Skipped: enrolment is cancelled or removed — invoice is not sent.');
  }
  if (!isEnrolmentEligibleForAutoInvoice(enrStatus) && !isEnrolmentEligibleForAutoInvoice(ssgStatus)) {
    throw new Error(
      `Skipped: enrolment is not Confirmed (local enrollment: ${enrStatus ?? '—'}, ssg_enrolments: ${ssgStatus ?? '—'}).`
    );
  }

  // 1) Grant refresh (populates ssg_grants for BL / Non-BL split).
  // MUST be awaited: resolveGrantDeductionLinesForInvoice reads ssg_grants right after this,
  // and DA enrolments can fall back to da_application's own subsidy fields when it's empty —
  // but non-DA individual invoices have no such fallback, so a fire-and-forget refresh here
  // raced that read and shipped invoices with the WSQ funding lines (and the GRN invoice,
  // which only fires when grant lines exist) silently missing whenever this was the first
  // grant fetch for the enrolment.
  try {
    await refreshGrantsForEnrolments([enrolmentId]);
  } catch (e) {
    console.warn('[invoice-job] Grant refresh failed (non-blocking):', e);
  }

  // The course product comes first. Besides pricing the line it decides the
  // FUNDING FAMILY: whether this learner's grants bill against the WSQ or the
  // CASL products is read from the product's own title, so a course renewed with
  // SSG takes effect as soon as QuickBooks is right - no deploy, no course-table
  // edit. (The lookup used to sit further down; it is only moved, not changed.)
  const cachedSku = readItemCache(_skuItemCache, courseCode);
  const item = cachedSku ?? (await qboFindItemBySku(undefined, courseCode));
  if (!item) throw new Error(`QuickBooks item not found for SKU: ${courseCode}`);
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
    throw new Error(
      `QuickBooks item "${item.name}" (SKU ${courseCode}) has unit price ${item.unitPrice}. Set a positive Unit Price on the Item in QuickBooks.`
    );
  }
  if (!cachedSku) writeItemCache(_skuItemCache, courseCode, item);

  // The QuickBooks product decides this: its title opens "CASL - ..." or
  // "WSQ - ...", and it is the same product the invoice bills against, so it
  // cannot disagree with the document. `courseTypeLabel` — the enrolment's real
  // course_type, read above — is the fallback for a product whose title carries
  // no prefix, and the DA title after that.
  const family: FundingFamily = detectFundingFamily(
    item.description,
    item.name,
    courseTypeLabel,
    da.course_title
  );

  const { lines: grantDeductionLines, totalSubsidy: grantSubsidy } = await resolveGrantDeductionLinesForInvoice({
    enrolmentId,
    combinedSubsidy,
    grantIdFallback: da.grant_id ?? null,
    // The course type the enrolment actually has. `family` above prefers the
    // QuickBooks product and falls back to this, so the two agree; passing the
    // resolved family keeps the deduction lines on products that exist.
    courseTypeLabel: family,
  });

  // Same guard as the DA pipeline: never bill a WSQ learner the full fee just
  // because the grant hasn't been issued yet. The refresh above is best-effort,
  // and an empty result reads identically to "not funded" — so without this the
  // job ships a plausible-looking invoice at 100% of the fee.
  //
  // Only enforced for DA-backed rows: those have a Generate Invoice button in
  // the DA view to override, and this queue path has no override of its own.
  // Non-DA enrolments keep their existing behaviour.
  // Foreigners are exempt: SSG funds only Citizens and PRs, so no grant will
  // ever arrive and the full fee is correct. Only a confident 'ineligible'
  // waives the guard — an unclassifiable ID stays protected.
  const eligibility = assessGrantEligibility({
    nric: da.trainee_id,
    idType: da.trainee_id_type,
  });
  const grantIneligible = eligibility.status === 'ineligible';

  if (hasDa && grantDeductionLines.length === 0 && grantSubsidy <= 0) {
    if (!grantIneligible) {
      throw new Error(
        `No SSG grant found for ${enrolmentId} — refusing to invoice the full course fee. ` +
          `Retry once SSG issues the grant, or use Generate Invoice in the DA view if this learner is genuinely unfunded.`
      );
    }
    console.log(`[invoice-job] ${enrolmentId}: billing the full course fee — ${eligibility.reason}`);
  }

  // 2) Sequential QB lookups — parallel QB calls race each other for the OAuth token refresh
  //    which causes timeouts. Sequential calls reuse the same cached token after the first refresh.
  const customerId =
    _cachedWsqiCustomerId ??
    (await qboFindCustomerByDisplayName(undefined, 'WSQ Individual (Not for Company)'));
  if (!customerId) throw new Error('QuickBooks customer not found: WSQ Individual (Not for Company)');
  _cachedWsqiCustomerId = customerId;

  const taxCodeGst = _cachedTaxCodeGst ?? (await qboResolveInvoiceLineTaxCodeRef(undefined));
  const taxCodeOos = _cachedTaxCodeOos ?? (await qboResolveOosTaxCodeRef(undefined));
  _cachedTaxCodeGst = taxCodeGst;
  _cachedTaxCodeOos = taxCodeOos;

  // Terms: Due on receipt
  if (!_cachedDueOnReceiptTermId) {
    const term = await qboFindTermByName(undefined, 'Due on receipt');
    if (term?.id) _cachedDueOnReceiptTermId = term.id;
  }
  // Terms: 35 Days Term (used for GRN/WSG invoices)
  if (!_cachedWsg35DaysTermId) {
    const term = await qboFindTermByName(undefined, '35 Days Term');
    if (term?.id) _cachedWsg35DaysTermId = term.id;
  }

  // Grant item lookups — cached at module level so only fetched once per server lifecycle
  const grantItems = new Map<string, { id: string; name: string; description: string | null }>();
  for (const g of grantDeductionLines) {
    if (grantItems.has(g.itemName)) continue;
    const cached = readItemCache(_grantItemCache, g.itemName);
    if (cached) {
      grantItems.set(g.itemName, cached);
      continue;
    }
    const found = await qboFindItemByName(undefined, g.itemName);
    if (!found) throw new Error(`QuickBooks item "${g.itemName}" not found. Create this item in QuickBooks (Sales → Products & Services).`);
    writeItemCache(_grantItemCache, g.itemName, found);
    grantItems.set(g.itemName, found);
  }

  // DB lookups don't need the QB token — run after token is warmed
  const ctx = await loadInvoiceContext(enrolmentId, userId, learnerEmail, courseCode);

  const actualFullCourseFee =
    (hasDa && fullCourseFee > 0) ? fullCourseFee :
      (ctx.feeExGst > 0 ? ctx.feeExGst : item.unitPrice);

  // Build invoice lines
  const lines: any[] = [];

  // Line 1: Full course fee with rich description
  lines.push({
    Amount: actualFullCourseFee,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: {
      ItemRef: { value: item.id },
      Qty: 1,
      UnitPrice: actualFullCourseFee,
      TaxCodeRef: { value: taxCodeGst },
    },
    Description: (() => {
      // Same rule as the DA pipeline: the wording is the product's, the values
      // are ours. Keeping both paths on one builder is the point — this file
      // used to carry its own copy of the text and the two drifted apart.
      //
      // Supersedes the withCourseTypePrefix() approach: the product's own
      // Description already opens with "CASL - ..." or "WSQ - ...", so the
      // prefix no longer has to be assembled from course_type. That type is
      // still consulted, as the fallback signal for `family` above.
      const courseTitle = hasDa ? (da.course_title ?? ctx.courseTitle) : ctx.courseTitle;
      const courseRef = hasDa ? (da.course_reference_number ?? ctx.courseRef) : ctx.courseRef;
      const fields: LineField[] = [
        {
          key: 'name',
          label: 'Participant Name',
          value: String(hasDa ? (da.trainee_name ?? ctx.traineeName) : ctx.traineeName ?? ''),
        },
        {
          key: 'nric',
          label: 'NRIC',
          value: maskNric(hasDa ? (da.trainee_id ?? ctx.traineeNric) : ctx.traineeNric),
        },
        {
          key: 'date',
          label: 'Course Date',
          value: (() => {
            const start = formatDate(hasDa ? da.course_start_date : ctx.startDate);
            const end = formatDate(hasDa ? da.course_end_date : ctx.endDate);
            return start === end || end === '—' ? start : `${start} - ${end}`;
          })(),
        },
        {
          key: 'run',
          label: 'Course Run',
          value: String((hasDa ? (da.course_run_id ?? ctx.runId) : ctx.runId) ?? ''),
        },
      ];
      const built = buildInvoiceLineText({
        productDescription: item.description,
        fields,
        fallbackHeading: buildCourseHeading({ family, title: courseTitle, courseCode: courseRef }),
        expectedCode: courseRef,
        headingPrefix: COURSE_LINE_HEADING_PREFIX,
      });
      if (built.source === 'fallback') {
        console.warn(
          `[invoice-job] Course line built from LMS data for ${courseRef}: ${built.reason}.`
        );
      }
      return built.text;
    })(),
  });

  // Lines 2+: funding deductions, against the WSQ or CASL products chosen above.
  // The wording is the product's own Description; we add only the grant refs.
  for (const g of grantDeductionLines) {
    const grantItem = grantItems.get(g.itemName)!;
    lines.push({
      Amount: -g.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: grantItem.id },
        Qty: 1,
        UnitPrice: -g.amount,
        TaxCodeRef: { value: taxCodeOos },
      },
      Description: buildInvoiceLineText({
        productDescription: grantItem.description,
        fields: [{ key: 'grantRef', label: 'Grant Ref #', value: `1. ${g.grantId}`, block: true }],
        fallbackHeading: g.description.split('\n')[0],
      }).text,
    });
  }

  // SkillsFuture Credit
  // QBO is picky: `DetailType: "DescriptionOnly"` often rejects `Amount` (code 2010).
  // Use a standard SalesItemLineDetail negative line so the deduction always applies.
  const sfcCredit = hasDa ? sfcCreditDa : ctx.sfcAmount;
  if (Number.isFinite(sfcCredit) && sfcCredit > 0) {
    // Prefer a dedicated item if it exists in QBO, otherwise fall back to the course item.
    // (Keeps the invoice readable when QBO has an "SFC Credit" / "SkillsFuture Credit" item configured.)
    // This used to search for 'SFC Credit' / 'SkillsFuture Credit', none of which
    // exist in the realm — so every credit deduction silently posted against the
    // COURSE product instead of its own. The DA pipeline has always used the
    // right name; both now read it from the same env-overridable constant.
    let sfcItem = readItemCache(_grantItemCache, SFC_ITEM_NAME);
    if (!sfcItem) {
      const byName = await qboFindItemByName(undefined, SFC_ITEM_NAME);
      if (byName?.id) {
        writeItemCache(_grantItemCache, SFC_ITEM_NAME, byName);
        sfcItem = readItemCache(_grantItemCache, SFC_ITEM_NAME);
      } else {
        console.warn(
          `[invoice-job] QuickBooks item "${SFC_ITEM_NAME}" not found; the credit line will post against the course product.`
        );
      }
    }
    lines.push({
      Amount: -sfcCredit,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: sfcItem?.id || item.id },
        Qty: 1,
        UnitPrice: -sfcCredit,
        TaxCodeRef: { value: taxCodeOos },
      },
      Description: hasDa
        ? (() => {
            const real = realApplicationId(da.application_id);
            return buildInvoiceLineText({
              productDescription: sfcItem?.description,
              fields: [
                {
                  key: 'claim',
                  label: real ? 'Application ID' : 'Enrolment ID',
                  value: real || enrolmentId,
                },
              ],
              fallbackHeading: 'SkillsFuture Credit Usage/Claim',
            }).text;
          })()
        : `To Less Skillsfuture Credit : $${sfcCredit.toFixed(2)}`,
    });
  }

  // Net amount (balance due) = fee + GST(9%) - grants - SFC.
  // Keep consistent with proforma generation (`0.09`).
  const gstRate = 0.09;
  const netAmount =
    (Number.isFinite(actualFullCourseFee) ? actualFullCourseFee : 0) * (1 + gstRate) -
    (Number.isFinite(grantSubsidy) ? grantSubsidy : 0) -
    (Number.isFinite(sfcCredit) ? sfcCredit : 0);
  const netAmountClamped = Number.isFinite(netAmount) ? Math.max(0, netAmount) : 0;

  const gtc = process.env.QBO_INVOICE_GLOBAL_TAX_CALC?.trim();
  const billToName = (hasDa ? (da.trainee_name ?? ctx.traineeName) : ctx.traineeName) || learnerEmail;
  const defaultEmailFields = await qboGetDefaultInvoiceEmailFields(undefined);
  const invoiceBody: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: lines,
    BillEmail: { Address: learnerEmail },
    ...defaultEmailFields,
    CustomerMemo: {
      value: `Skillsfuture Claimable Amount : $${netAmountClamped.toFixed(2)}`,
    },
    ...( _cachedDueOnReceiptTermId ? { SalesTermRef: { value: _cachedDueOnReceiptTermId } } : {} ),
    // Override QBO Customer default addresses (which can include placeholder text).
    // Finance requirement: invoice billing address should show trainee name only,
    // and shipping details should not be populated.
    BillAddr: { Line1: billToName },
    ShipAddr: { Line1: '' },
    PrivateNote: `SSG enrolment: ${enrolmentId}`,
  };
  if (gtc && gtc.toLowerCase() !== 'omit') {
    invoiceBody.GlobalTaxCalculation = gtc;
  }

  let invoiceId: string = job.qbo_invoice_id ? String(job.qbo_invoice_id) : '';
  let docNumber: string | null = job.qbo_doc_number ?? null;
  let invoiceNo: string | null = job.invoice_no ? String(job.invoice_no).trim() || null : null;

  // If the stored QBO invoice id was deleted in QBO, clear it so we recreate on re-queue.
  if (invoiceId) {
    try {
      await qboReadInvoice(undefined, invoiceId);
    } catch (e) {
      console.warn('[invoice-job] Stored QBO invoice id not found; will recreate:', e instanceof Error ? e.message : e);
      invoiceId = '';
      docNumber = null;
      await pool.query(
        `UPDATE public.invoice_jobs
         SET qbo_invoice_id = NULL, qbo_doc_number = NULL, updated_at = now()
         WHERE id = $1`,
        [jobId]
      );
    }
  }

  if (!invoiceId) {
    invoiceNo = await reserveTmsInvoiceNo(jobId, enrolmentId, invoiceNo);
    invoiceBody.DocNumber = invoiceNo;

    // Idempotency: check if QB already has an invoice with this DocNumber before creating.
    // Prevents duplicate invoices when two concurrent processes both see qbo_invoice_id = null.
    // IMPORTANT: verify the found invoice belongs to THIS enrolment via PrivateNote — two ENRs
    // can share the same last-6-digit sequence (e.g. ENR-2604-046027 and ENR-2606-046027 both
    // produce TC26-MMDD-046027) causing a DocNumber collision that would link the wrong invoice.
    const existingInv = await qboFindInvoiceByDocNumber(undefined, invoiceNo!);
    const existingInvOwnsThisEnrolment = existingInv?.id &&
      String(existingInv.raw?.PrivateNote || '').includes(enrolmentId);
    if (existingInv?.id && existingInvOwnsThisEnrolment) {
      invoiceId = existingInv.id;
      docNumber = invoiceNo;
      await pool.query(
        `UPDATE public.invoice_jobs
         SET qbo_invoice_id = $2, qbo_doc_number = $3, invoice_no = COALESCE(invoice_no, $4), updated_at = now()
         WHERE id = $1`,
        [jobId, invoiceId, docNumber, invoiceNo]
      );
    } else {
      // If a DocNumber collision was detected (invoice exists but belongs to a different enrolment),
      // force a new unique number using a salt so we don't steal another enrolment's invoice.
      if (existingInv?.id && !existingInvOwnsThisEnrolment) {
        console.warn(`[invoice-job] DocNumber collision for ${invoiceNo!} — invoice belongs to different enrolment. Generating new number.`);
        invoiceNo = await reserveTmsInvoiceNo(jobId, enrolmentId, null); // null forces a fresh salt-based number
        invoiceBody.DocNumber = invoiceNo;
      }
      let inv;
      try {
        inv = await step('QBO create invoice', () => qboCreateInvoice(undefined, invoiceBody));
      } catch (err) {
        if (err && typeof err === 'object') {
          console.error('[QBO create invoice error]', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        } else {
          console.error('[QBO create invoice error]', err);
        }
        throw err;
      }
      if (!inv.id) throw new Error('QBO create invoice: QuickBooks returned no Id');
      invoiceId = inv.id;
      docNumber = inv.docNumber ?? invoiceNo;
      await pool.query(
        `UPDATE public.invoice_jobs
         SET qbo_invoice_id = $2, qbo_doc_number = $3, invoice_no = COALESCE(invoice_no, $4), updated_at = now()
         WHERE id = $1`,
        [jobId, invoiceId, docNumber, invoiceNo]
      );
    }
  }

  // Compute GRN ref before marking done so the column is populated the moment the UI sees 'done'.
  const existingGrnRef = job.grn_doc_number ? String(job.grn_doc_number).trim() || null : null;
  const primaryGrnRef =
    grantDeductionLines.length > 0 && grantDeductionLines[0].grantId !== '—'
      ? grantDeductionLines[0].grantId
      : null;
  const desiredGrnRef = (existingGrnRef || primaryGrnRef || '').trim() || null;

  // 5) Mark done as soon as the invoice exists in QBO.
  // PDF + Drive upload can be slow; do it after the job is "done" to keep Finance UX responsive.
  await pool.query(
    `UPDATE public.invoice_jobs
     SET status = 'done',
         grn_doc_number = COALESCE(grn_doc_number, $2),
         updated_at = now()
     WHERE id = $1`,
    [jobId, desiredGrnRef]
  );

  // Snapshot the customer invoice number (TC...) for GRN creation.
  // Do NOT rely on `job.invoice_no` here because `job` is an earlier DB snapshot.
  const mainCustomerInvoiceNoForGrn = String(invoiceNo || docNumber || '').trim();

  // 6) Post-steps (do not block job completion)
  void (async () => {
    // Optionally email invoice from QBO (off by default — set QBO_SEND_INVOICE_EMAIL=true)
    try {
      if (shouldSendQboInvoiceEmailFromQuickBooks()) {
        await step('QBO send invoice', () => qboSendInvoice(undefined, invoiceId));
      } else {
        console.log('[invoice-job] Skipping QBO customer email (set QBO_SEND_INVOICE_EMAIL=true to enable)');
      }
    } catch (e) {
      console.warn('[invoice-job] QBO send invoice (post-step):', e);
    }

    // Download PDF + upload to Drive
    try {
      const pdf = await step('QBO fetch invoice PDF', () => qboFetchInvoicePdf(undefined, invoiceId));
      const fallbackNo = buildTmsInvoiceNo(enrolmentId, new Date(), 0);
      const fileName = `QB_invoice_${safeText(invoiceNo || docNumber || fallbackNo)}.pdf`;
      const drive = await step('Google Drive upload', () => uploadInvoicePdfToDrive({ pdf, fileName }));
      await pool.query(
        `UPDATE public.invoice_jobs
         SET drive_file_id = $2,
             drive_web_view_link = $3,
             updated_at = now()
         WHERE id = $1`,
        [jobId, drive.fileId, drive.webViewLink]
      );
    } catch (e) {
      console.warn('[invoice-job] PDF/Drive (post-step):', e);
    }

    // Keep ssg_enrolments in sync (best-effort)
    try {
      await upsertSsgEnrolmentFromLocalEnrollment(enrolmentId);
    } catch (e) {
      console.warn('[invoice-job] ssg_enrolments upsert (post-step):', e);
    }

    // Create GRN invoice in QB (post-step — errors here don't fail invoice generation)
    // desiredGrnRef is already computed and saved at the done-mark step above.
    if (grantDeductionLines.length > 0 && desiredGrnRef) {
      try {
        const existingGrn = await qboFindInvoiceByDocNumber(undefined, desiredGrnRef);
        let grnInvoiceId: string | null = existingGrn?.id || null;

        if (!existingGrn?.id) {
          const wsgCustomerId =
            (await qboFindOrCreateCustomerByDisplayName(undefined, 'Singapore Workforce Development Agency (WSG)')) ||
            (await qboFindOrCreateCustomerByDisplayName(undefined, 'WSG'));
          // The staff-facing GRN invoice mirrors the learner's invoice line for
          // line, so it takes its wording from the same products.
          const grnLines = grantDeductionLines.map((g) => {
            const grantItem = grantItems.get(g.itemName)!;
            return {
              Amount: g.amount,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: {
                ItemRef: { value: grantItem.id },
                Qty: 1,
                UnitPrice: g.amount,
                TaxCodeRef: { value: taxCodeOos },
              },
              Description: buildInvoiceLineText({
                productDescription: grantItem.description,
                fields: [{ key: 'grantRef', label: 'Grant Ref #', value: `1. ${g.grantId}`, block: true }],
                fallbackHeading: g.description.split('\n')[0],
              }).text,
            };
          });

          const txnDate = getLocalYMD(new Date());
          const dueDate = addDaysIso(txnDate, 35);
          const grnBody: Record<string, unknown> = {
            CustomerRef: { value: wsgCustomerId },
            BillAddr: { Line1: 'Singapore Workforce Development Agency (WSG)' },
            BillEmail: { Address: 'angch@tertiaryinfotech.com' },
            TxnDate: txnDate,
            DueDate: dueDate,
            DocNumber: desiredGrnRef,
            Line: grnLines,
            ...(mainCustomerInvoiceNoForGrn ? { PONumber: mainCustomerInvoiceNoForGrn } : {}),
            ...(_cachedWsg35DaysTermId ? { SalesTermRef: { value: _cachedWsg35DaysTermId } } : {}),
            PrivateNote: `SSG enrolment: ${enrolmentId}`,
            GlobalTaxCalculation: 'TaxExcluded',
          };
          const grnInv = await qboCreateInvoice(undefined, grnBody);
          grnInvoiceId = grnInv?.id || null;
        }

        // Ensure grn_doc_number is persisted (belt-and-suspenders; already set at done-mark).
        await pool.query(
          `UPDATE public.invoice_jobs SET grn_doc_number = $2, updated_at = now() WHERE id = $1`,
          [jobId, desiredGrnRef]
        );

        // Fetch GRN PDF and upload to the same Drive invoices folder.
        if (grnInvoiceId) {
          try {
            const grnPdf = await qboFetchInvoicePdf(undefined, grnInvoiceId);
            const grnFileName = `NON-DA_GRANT_QB_invoice_${safeText(desiredGrnRef)}.pdf`;
            const grnDrive = await uploadInvoicePdfToDrive({ pdf: grnPdf, fileName: grnFileName });
            await pool.query(
              `UPDATE public.invoice_jobs
               SET grn_drive_file_id = $2, grn_drive_web_view_link = $3, updated_at = now()
               WHERE id = $1`,
              [jobId, grnDrive.fileId, grnDrive.webViewLink]
            );
          } catch (e) {
            console.warn('[invoice-job] GRN PDF/Drive (post-step):', e);
          }
        }
      } catch (e) {
        console.warn('[invoice-job] GRN invoice creation (post-step):', e);
      }
    }
  })();
}
