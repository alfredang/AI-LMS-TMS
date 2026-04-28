import pool from '../db';
import { buildTmsInvoiceNo } from '../utils/tmsInvoiceNo';
import { isEnrolmentBlockedFromAutoInvoice, isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';
import { refreshGrantsForEnrolments, upsertSsgEnrolmentFromLocalEnrollment } from './billingSync';
import { uploadInvoicePdfToDrive } from './invoiceDriveUpload';
import { resolveGrantDeductionLinesForInvoice } from './daInvoiceGrantLines';
import {
  qboCreateInvoice,
  qboFetchInvoicePdf,
  qboFindCustomerByDisplayName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboFindItemBySku,
  qboFindOrCreateCustomerByDisplayName,
  qboFindTermByName,
  qboResolveInvoiceLineTaxCodeRef,
  qboResolveOosTaxCodeRef,
  qboSendInvoice,
} from './qboInvoiceService';
import { shouldSendQboInvoiceEmailFromQuickBooks } from './qboInvoiceEmailPolicy';

// Grant QB items are fixed ("WSQ funding (Baseline)", "WSQ funding (MCES)").
// Cache their IDs at module level so subsequent invoice jobs don't re-query QB.
const _grantItemCache = new Map<string, string>();
const _skuItemCache = new Map<string, { id: string; name: string; unitPrice: number }>();
let _cachedWsqiCustomerId: string | null = null;
let _cachedTaxCodeGst: string | null = null;
let _cachedTaxCodeOos: string | null = null;
let _cachedSfcItemId: string | null = null;
let _cachedDueOnReceiptTermId: string | null = null;

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function maskNric(nric: string | null | undefined): string {
  const s = String(nric || '').trim();
  if (!s || s === '—') return '—';
  return s.length > 4 ? '****' + s.slice(-4) : s;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.trim() : '';
  if (s && /^\d{8}$/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const x = new Date(iso);
    if (!Number.isNaN(x.getTime())) {
      return x.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  return new Date(d).toLocaleDateString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function maskNric(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 4) return raw;
  return 'X'.repeat(raw.length - 4) + raw.slice(-4);
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
            trainee_name, trainee_id, course_run_id, grant_id,
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

  if (isEnrolmentBlockedFromAutoInvoice(enrStatus) || isEnrolmentBlockedFromAutoInvoice(ssgStatus)) {
    throw new Error('Skipped: enrolment is cancelled or removed — invoice is not sent.');
  }
  if (!isEnrolmentEligibleForAutoInvoice(enrStatus) && !isEnrolmentEligibleForAutoInvoice(ssgStatus)) {
    throw new Error(
      `Skipped: enrolment is not Confirmed (local enrollment: ${enrStatus ?? '—'}, ssg_enrolments: ${ssgStatus ?? '—'}).`
    );
  }

  // 1) Best-effort grant refresh (populates ssg_grants for BL / Non-BL split)
  try {
    // Do not block invoice generation on SSG sync latency.
    // `resolveGrantDeductionLinesForInvoice` can still use existing rows (or fall back).
    void refreshGrantsForEnrolments([enrolmentId]);
  } catch (e) {
    console.warn('[invoice-job] Grant refresh failed (non-blocking):', e);
  }

  const { lines: grantDeductionLines, totalSubsidy: grantSubsidy } = await resolveGrantDeductionLinesForInvoice({
    enrolmentId,
    combinedSubsidy,
    grantIdFallback: da.grant_id ?? null,
  });

  // 2) Sequential QB lookups — parallel QB calls race each other for the OAuth token refresh
  //    which causes timeouts. Sequential calls reuse the same cached token after the first refresh.
  const cachedSku = _skuItemCache.get(courseCode);
  const item = cachedSku ?? (await qboFindItemBySku(undefined, courseCode));
  if (!item) throw new Error(`QuickBooks item not found for SKU: ${courseCode}`);
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
    throw new Error(
      `QuickBooks item "${item.name}" (SKU ${courseCode}) has unit price ${item.unitPrice}. Set a positive Unit Price on the Item in QuickBooks.`
    );
  }
  if (!cachedSku) {
    // Keep cache bounded in case of many course codes.
    if (_skuItemCache.size > 200) _skuItemCache.clear();
    _skuItemCache.set(courseCode, { id: item.id, name: item.name, unitPrice: item.unitPrice });
  }

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

  // Grant item lookups — cached at module level so only fetched once per server lifecycle
  const grantItemIdCache = new Map<string, string>();
  for (const g of grantDeductionLines) {
    if (!grantItemIdCache.has(g.itemName)) {
      const cached = _grantItemCache.get(g.itemName);
      if (cached) {
        grantItemIdCache.set(g.itemName, cached);
      } else {
        const found = await qboFindItemByName(undefined, g.itemName);
        if (!found) throw new Error(`QuickBooks item "${g.itemName}" not found. Create this item in QuickBooks (Sales → Products & Services).`);
        _grantItemCache.set(g.itemName, found.id);
        grantItemIdCache.set(g.itemName, found.id);
      }
    }
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
    Description: [
      `Course Name: ${hasDa ? (da.course_title ?? ctx.courseTitle) : ctx.courseTitle}`,
      `(${hasDa ? (da.course_reference_number ?? ctx.courseRef) : ctx.courseRef})`,
      `Participant Name: ${hasDa ? (da.trainee_name ?? ctx.traineeName) : ctx.traineeName}`,
      `NRIC: ${maskNric(hasDa ? (da.trainee_id ?? ctx.traineeNric) : ctx.traineeNric)}`,
      (() => {
        const start = formatDate(hasDa ? da.course_start_date : ctx.startDate);
        const end = formatDate(hasDa ? da.course_end_date : ctx.endDate);
        if (start === end || end === '—') return `Course Date: ${start}`;
        return `Course Date: ${start} - ${end}`;
      })(),
      `Course Run: ${hasDa ? (da.course_run_id ?? ctx.runId) : ctx.runId}`,
    ].join('\n'),
  });

  // Lines 2+: WSQ grants — named QB items ("WSQ funding (Baseline)" / "WSQ funding (MCES)")
  for (const g of grantDeductionLines) {
    lines.push({
      Amount: -g.amount,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: grantItemIdCache.get(g.itemName)! },
        Qty: 1,
        UnitPrice: -g.amount,
        TaxCodeRef: { value: taxCodeOos },
      },
      Description: g.description,
    });
  }

  // SkillsFuture Credit
  // QBO is picky: `DetailType: "DescriptionOnly"` often rejects `Amount` (code 2010).
  // Use a standard SalesItemLineDetail negative line so the deduction always applies.
  const sfcCredit = hasDa ? sfcCreditDa : ctx.sfcAmount;
  if (Number.isFinite(sfcCredit) && sfcCredit > 0) {
    // Prefer a dedicated item if it exists in QBO, otherwise fall back to the course item.
    // (Keeps the invoice readable when QBO has an "SFC Credit" / "SkillsFuture Credit" item configured.)
    let sfcItemId = _cachedSfcItemId;
    if (!sfcItemId) {
      const byName =
        (await qboFindItemByName(undefined, 'SFC Credit')) ||
        (await qboFindItemByName(undefined, 'SkillsFuture Credit')) ||
        (await qboFindItemByName(undefined, 'Skillsfuture Credit'));
      if (byName?.id) {
        sfcItemId = byName.id;
        _cachedSfcItemId = byName.id;
      }
    }
    lines.push({
      Amount: -sfcCredit,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: sfcItemId || item.id },
        Qty: 1,
        UnitPrice: -sfcCredit,
        TaxCodeRef: { value: taxCodeOos },
      },
      Description: `To Less Skillsfuture Credit : $${sfcCredit.toFixed(2)}`,
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

  // Always show a 4th row message (informational only; no amount field to avoid QBO parse errors).
  lines.push({
    DetailType: 'DescriptionOnly',
    DescriptionLineDetail: {},
    Description: `To Less Skillsfuture Credit : $${netAmountClamped.toFixed(2)}`,
  });

  const gtc = process.env.QBO_INVOICE_GLOBAL_TAX_CALC?.trim();
  const billToName = (hasDa ? (da.trainee_name ?? ctx.traineeName) : ctx.traineeName) || learnerEmail;
  const invoiceBody: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: lines,
    BillEmail: { Address: learnerEmail },
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

  if (!invoiceId) {
    invoiceNo = await reserveTmsInvoiceNo(jobId, enrolmentId, invoiceNo);
    invoiceBody.DocNumber = invoiceNo;

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

  // 5) Mark done as soon as the invoice exists in QBO.
  // PDF + Drive upload can be slow; do it after the job is "done" to keep Finance UX responsive.
  await pool.query(
    `UPDATE public.invoice_jobs
     SET status = 'done',
         updated_at = now()
     WHERE id = $1`,
    [jobId]
  );

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
    const existingGrnRef = job.grn_doc_number ? String(job.grn_doc_number).trim() || null : null;
    if (!existingGrnRef && grantDeductionLines.length > 0) {
      try {
        const primaryGrnRef = grantDeductionLines[0].grantId !== '—' ? grantDeductionLines[0].grantId : null;
        if (primaryGrnRef) {
          const existingGrn = await qboFindInvoiceByDocNumber(undefined, primaryGrnRef);
          if (!existingGrn?.id) {
            const wsgCustomerId = await qboFindOrCreateCustomerByDisplayName(undefined, 'WSG');
            const grnLines = grantDeductionLines.map((g) => ({
              Amount: g.amount,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: {
                ItemRef: { value: grantItemIdCache.get(g.itemName)! },
                Qty: 1,
                UnitPrice: g.amount,
                TaxCodeRef: { value: taxCodeOos },
              },
              Description: g.description.replace(/^Less: /, ''),
            }));
            const grnBody: Record<string, unknown> = {
              CustomerRef: { value: wsgCustomerId },
              DocNumber: primaryGrnRef,
              Line: grnLines,
              PrivateNote: `SSG enrolment: ${enrolmentId}`,
            };
            if (gtc && gtc.toLowerCase() !== 'omit') grnBody.GlobalTaxCalculation = gtc;
            await qboCreateInvoice(undefined, grnBody);
          }
          await pool.query(
            `UPDATE public.invoice_jobs SET grn_doc_number = $2, updated_at = now() WHERE id = $1`,
            [jobId, primaryGrnRef]
          );
        }
      } catch (e) {
        console.warn('[invoice-job] GRN invoice creation (post-step):', e);
      }
    }
  })();
}
