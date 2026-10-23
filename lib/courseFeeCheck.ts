import pool from './db';
import { RUN_COURSE_CODE_SQL, COURSE_ID_BY_ANY_CODE_SQL } from './courseCode';
import { qboFindItemBySku, qboUpdateItemUnitPrice } from './services/qboInvoiceService';

/**
 * Pre-flight check for Company Application enrolment and invoicing: is the
 * course fee the invoice will bill actually set, and does it agree with the
 * QuickBooks product? The invoice prices the course line from course.course_fee
 * while SSG works the grant out from its own fee, so a stale LMS fee bills the
 * wrong net (Oct 2026: AI for Shopify was $350 in the LMS against SSG's $720).
 *
 * Read-only. Mirrors how the invoice resolves the course: run → course, with
 * the run's current TGS code as the QuickBooks SKU (RUN_COURSE_CODE_SQL).
 */

export interface CourseFeeCheckItem {
  courseRunId?: string;
  courseReferenceNumber?: string;
  courseTitle?: string;
}

export type CourseFeeProblem = 'no_lms_fee' | 'no_qbo_product' | 'mismatch';

export interface CourseFeeIssue {
  courseId: string;
  courseTitle: string;
  courseReferenceNumber: string;
  lmsFee: number | null;
  qboPrice: number | null;
  problem: CourseFeeProblem;
}

export interface CourseFeeCheckResult {
  issues: CourseFeeIssue[];
  /** QuickBooks could not be reached, so only blank LMS fees were checked. */
  qboUnavailable: boolean;
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

async function resolveCourse(item: CourseFeeCheckItem): Promise<{ id: string; title: string; fee: number | null; code: string } | null> {
  const runId = text(item.courseRunId);
  if (runId) {
    const r = await pool.query(
      `SELECT c.id, c.title, c.course_fee, ${RUN_COURSE_CODE_SQL}::text AS code
         FROM public.course_run cr JOIN public.course c ON c.id = cr.course_id
        WHERE (cr.course_run_id = $1 OR cr.id::text = $1) AND COALESCE(cr.is_deleted, false) = false
        LIMIT 1`,
      [runId]
    );
    if (r.rows[0]) return toCourse(r.rows[0], r.rows[0].code);
  }

  const code = text(item.courseReferenceNumber).toUpperCase();
  if (code) {
    const r = await pool.query(
      `SELECT c.id, c.title, c.course_fee FROM public.course c WHERE c.id = (${COURSE_ID_BY_ANY_CODE_SQL})`,
      [code]
    );
    if (r.rows[0]) return toCourse(r.rows[0], code);
  }

  const title = text(item.courseTitle);
  if (title) {
    const r = await pool.query(
      `SELECT c.id, c.title, c.course_fee, COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS code
         FROM public.course c WHERE LOWER(TRIM(c.title)) = LOWER($1) LIMIT 2`,
      [title]
    );
    // Two courses with one title cannot be told apart here; the upload's own
    // course-run step deals with that, so don't guess a fee for it.
    if (r.rows.length === 1) return toCourse(r.rows[0], r.rows[0].code);
  }
  return null;
}

function toCourse(row: any, code: unknown) {
  const fee = row.course_fee == null ? null : Number(row.course_fee);
  return {
    id: String(row.id),
    title: text(row.title),
    fee: fee != null && Number.isFinite(fee) && fee > 0 ? fee : null,
    code: text(code).toUpperCase(),
  };
}

export async function checkCourseFees(items: CourseFeeCheckItem[]): Promise<CourseFeeCheckResult> {
  const courses = new Map<string, { id: string; title: string; fee: number | null; code: string }>();
  // An upload of hundreds of learners is usually one or two courses — resolve
  // each distinct (run, code, title) once instead of once per learner.
  const distinct = new Map<string, CourseFeeCheckItem>();
  for (const item of items) {
    distinct.set(`${text(item.courseRunId)}|${text(item.courseReferenceNumber).toUpperCase()}|${text(item.courseTitle).toLowerCase()}`, item);
  }
  for (const item of Array.from(distinct.values()).slice(0, 50)) {
    const course = await resolveCourse(item);
    if (course) courses.set(`${course.id}|${course.code}`, course);
  }

  const issues: CourseFeeIssue[] = [];
  let qboUnavailable = false;
  for (const course of Array.from(courses.values())) {
    const base = { courseId: course.id, courseTitle: course.title, courseReferenceNumber: course.code, lmsFee: course.fee };
    if (course.fee == null) {
      issues.push({ ...base, qboPrice: null, problem: 'no_lms_fee' });
      continue;
    }
    if (!course.code || qboUnavailable) continue;
    try {
      const item = await qboFindItemBySku(undefined, course.code);
      const price = Number(item?.unitPrice || 0);
      if (!item?.id) {
        issues.push({ ...base, qboPrice: null, problem: 'no_qbo_product' });
      } else if (price > 0 && Math.abs(price - course.fee) > 0.005) {
        // Same rule as the invoice guard in createCompanyApplicationInvoice.
        issues.push({ ...base, qboPrice: price, problem: 'mismatch' });
      }
    } catch (err) {
      console.warn('[courseFeeCheck] QuickBooks lookup failed; checking LMS fees only:', err instanceof Error ? err.message : err);
      qboUnavailable = true;
    }
  }
  return { issues, qboUnavailable };
}

export interface SetCourseFeeResult {
  courseTitle: string;
  courseReferenceNumber: string;
  oldFee: number | null;
  newFee: number;
  /** True when the QuickBooks product price was changed to match. */
  qboUpdated: boolean;
  /** Set when the LMS was updated but QuickBooks could not be. */
  qboError?: string;
}

/**
 * Save the correct course fee from the Company Application fee popup, so this
 * and every later enrolment / invoice for the course uses it. Writes the same
 * fee fields the course edit screen does (incl. GST and the after-funding
 * prices shown elsewhere), then — when asked — sets the QuickBooks product to
 * the same price so the invoice's mismatch guard is satisfied.
 */
export async function setCourseFee(
  courseId: string,
  courseReferenceNumber: string,
  fee: number,
  options: { updateQuickBooks: boolean; changedBy: string }
): Promise<SetCourseFeeResult> {
  if (!Number.isFinite(fee) || fee <= 0 || fee > 100000) throw new Error('Enter a course fee greater than $0.');
  const newFee = Math.round(fee * 100) / 100;

  const current = await pool.query(
    `SELECT title, course_fee, COALESCE(tax_percent, 0.09)::numeric AS tax FROM public.course WHERE id = $1`,
    [courseId]
  );
  const row = current.rows[0];
  if (!row) throw new Error('Course not found.');
  // Stored as a fraction (0.09). Guard against a percentage (9) ever being
  // saved, which would multiply every derived price by ten.
  const rawTax = Number(row.tax);
  const tax = rawTax > 1 ? rawTax / 100 : rawTax;
  const oldFee = row.course_fee == null ? null : Number(row.course_fee);
  const plain = (n: number) => String(Math.round(n * 100) / 100);

  // after_normal_funding / after_mces_funding: what the learner pays after the
  // 50% / 70% grant, with GST charged on the full fee (matches existing rows).
  await pool.query(
    `UPDATE public.course
        SET course_fee = $2,
            course_fees_exclude_gst = $3,
            course_fees_include_gst = $4,
            after_normal_funding = $5,
            after_mces_funding = $6,
            updated_at = now()
      WHERE id = $1`,
    [courseId, newFee, plain(newFee), plain(newFee * (1 + tax)),
      (newFee * (0.5 + tax)).toFixed(2), (newFee * (0.3 + tax)).toFixed(2)]
  );
  console.log(`[courseFee] ${row.title} (${courseReferenceNumber}) fee ${oldFee ?? 'blank'} → ${newFee} by user ${options.changedBy}`);

  const result: SetCourseFeeResult = {
    courseTitle: text(row.title),
    courseReferenceNumber,
    oldFee,
    newFee,
    qboUpdated: false,
  };

  if (options.updateQuickBooks && courseReferenceNumber) {
    try {
      const item = await qboFindItemBySku(undefined, courseReferenceNumber);
      if (!item?.id) {
        result.qboError = `No QuickBooks product with SKU ${courseReferenceNumber}. Create it in QuickBooks.`;
      } else if (Math.abs(Number(item.unitPrice || 0) - newFee) > 0.005) {
        await qboUpdateItemUnitPrice(undefined, item.id, newFee);
        result.qboUpdated = true;
        console.log(`[courseFee] QuickBooks product ${item.name} price ${item.unitPrice} → ${newFee} by user ${options.changedBy}`);
      }
    } catch (err) {
      result.qboError = `LMS fee saved, but QuickBooks could not be updated: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return result;
}
