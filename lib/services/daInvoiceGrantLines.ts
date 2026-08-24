import pool from '../db';
import { resolveFundingItemName, type FundingFamily } from '../quickbooks/invoiceLineText';

/**
 * Negative invoice lines for QuickBooks: Baseline and first Non-Baseline grant,
 * using the same row selection as consolidated finance (`all-course-runs`).
 */
export interface GrantDeductionLine {
  amount: number;
  grantId: string;
  /**
   * Wording for the line.
   *
   * Direct Application invoices no longer print this. They take the text from
   * the QBO product's Description box (lib/quickbooks/invoiceLineText.ts), so a
   * course renewed WSQ -> CASL is fixed by editing the product rather than by a
   * deploy. This stays as the fallback for a product with an empty Description,
   * and Company Application grant invoices still use it directly.
   */
  description: string;
  /**
   * QB Item Name for this line: 'WSQ Funding (Baseline)', 'CASL Funding
   * (MCES/SME)', and so on.
   *
   * This is the one thing QuickBooks cannot tell us. The product holds the
   * wording, but only the course says which FAMILY of funding products a
   * learner's grant belongs to.
   */
  itemName: string;
}

function isPositiveMoney(value: unknown): boolean {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(n) && n > 0;
}

/**
 * The enrolment's course type, reduced to a family of funding products that
 * actually exists in QuickBooks.
 *
 * `courseTypeLabel` is the real `course.course_type` — 'WSQ', 'CASL', 'IBF' or
 * 'Non-WSQ' — and using it is the point: non-DA invoices used to hardcode WSQ
 * and mislabelled every CASL course.
 *
 * But the realm holds exactly six funding products, four WSQ and two CASL, so a
 * type cannot be pasted straight into an item name. `IBF funding (Baseline)` and
 * `CASL funding (MCES)` name nothing, and an item that does not resolve fails
 * invoice generation outright. Anything without its own products bills against
 * the WSQ ones, as it did before course type was consulted at all, and says so
 * in the log rather than failing the invoice.
 */
function familyFromCourseType(courseTypeLabel?: string | null): FundingFamily {
  const type = String(courseTypeLabel || '').trim().toUpperCase();
  if (type === 'CASL') return 'CASL';
  if (type && type !== 'WSQ') {
    console.warn(
      `[grant lines] No funding products exist for course type "${courseTypeLabel}"; billing against the WSQ products.`
    );
  }
  return 'WSQ';
}

/** The label shown in fallback wording — matches the product family actually billed. */
function labelForFamily(family: FundingFamily): string {
  return family === 'CASL' ? 'CASL' : 'WSQ';
}

/**
 * `courseTypeLabel` defaults to WSQ so callers that predate the CASL split keep
 * their exact previous behaviour.
 *
 * The scheme keyword matching itself lives in resolveFundingItemName, shared
 * with the course-line builder so the two can never drift apart, and it only
 * ever returns one of the six names that exist.
 */
function resolveGrantItemName(opts: {
  courseTypeLabel?: string | null;
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
}): string {
  return resolveFundingItemName({
    family: familyFromCourseType(opts.courseTypeLabel),
    fundingSchemeCode: opts.fundingSchemeCode,
    fundingSchemeDescription: opts.fundingSchemeDescription,
  });
}

/**
 * Loads up to two grant rows from `ssg_grants` for an SSG enrolment reference (ENR-...).
 */
export async function loadSplitGrantDeductionsFromDb(
  enrolmentId: string | null | undefined,
  courseTypeLabel?: string | null
): Promise<{ lines: GrantDeductionLine[]; totalAmount: number }> {
  const ref = String(enrolmentId || '').trim();
  if (!ref) return { lines: [], totalAmount: 0 };

  const [blRes, nblRes] = await Promise.all([
    pool.query(
      `SELECT grant_id,
             (CASE
               WHEN COALESCE(NULLIF(TRIM(COALESCE(approved_grant_amount::text, '')), ''), '0')::float > 0
                 THEN COALESCE(NULLIF(TRIM(COALESCE(approved_grant_amount::text, '')), ''), '0')::float
               ELSE COALESCE(NULLIF(TRIM(COALESCE(estimated_grant_amount::text, '')), ''), '0')::float
             END) AS amt,
             funding_scheme_description,
             funding_scheme_code
       FROM ssg_grants
       WHERE LOWER(TRIM(COALESCE(enrollment_id, ''))) = LOWER(TRIM($1::text))
         AND (
               UPPER(COALESCE(funding_scheme_code, '')) IN ('BL', 'BASELINE')
            OR UPPER(COALESCE(funding_scheme_code, '')) LIKE '%BASELINE%'
         )
       ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
       LIMIT 1`,
      [ref]
    ),
    pool.query(
      `SELECT grant_id,
             (CASE
               WHEN COALESCE(NULLIF(TRIM(COALESCE(approved_grant_amount::text, '')), ''), '0')::float > 0
                 THEN COALESCE(NULLIF(TRIM(COALESCE(approved_grant_amount::text, '')), ''), '0')::float
               ELSE COALESCE(NULLIF(TRIM(COALESCE(estimated_grant_amount::text, '')), ''), '0')::float
             END) AS amt,
             funding_scheme_description,
             funding_scheme_code
       FROM ssg_grants
       WHERE LOWER(TRIM(COALESCE(enrollment_id, ''))) = LOWER(TRIM($1::text))
         AND UPPER(COALESCE(funding_scheme_code, '')) NOT IN ('BL', 'BASELINE')
         AND UPPER(COALESCE(funding_scheme_code, '')) NOT LIKE '%BASELINE%'
       ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
       LIMIT 1`,
      [ref]
    ),
  ]);

  const lines: GrantDeductionLine[] = [];

  // Wording for the fallback `description` below. It only reaches an invoice
  // when the funding product has an empty Description box in QuickBooks — but it
  // has to name the same family the line is actually billed against, so it uses
  // the resolved family rather than the raw course type.
  const label = labelForFamily(familyFromCourseType(courseTypeLabel));

  const bl = blRes.rows[0] as {
    grant_id?: string;
    amt?: number;
    funding_scheme_description?: string | null;
    funding_scheme_code?: string | null;
  } | undefined;
  if (bl && Number(bl.amt) > 0) {
    const gid = String(bl.grant_id ?? '-');
    lines.push({
      amount: Number(bl.amt),
      grantId: gid,
      description: `Less: ${label} funding (Baseline)\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({
        courseTypeLabel,
        fundingSchemeCode: bl.funding_scheme_code ?? 'Baseline',
        fundingSchemeDescription: bl.funding_scheme_description ?? 'Baseline',
      }),
    });
  }

  const nbl = nblRes.rows[0] as {
    grant_id?: string;
    amt?: number;
    funding_scheme_code?: string | null;
    funding_scheme_description?: string | null;
  } | undefined;
  if (nbl && Number(nbl.amt) > 0) {
    const gid = String(nbl.grant_id ?? '-');
    const scheme = (nbl.funding_scheme_description || 'Non-Baseline').trim();
    lines.push({
      amount: Number(nbl.amt),
      grantId: gid,
      description: `Less: ${label} funding (${scheme})\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({
        courseTypeLabel,
        fundingSchemeCode: nbl.funding_scheme_code,
        fundingSchemeDescription: nbl.funding_scheme_description,
      }),
    });
  }

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, totalAmount };
}

/** Legacy single line when `ssg_grants` has not been populated yet. */
export function buildFallbackCombinedGrantLine(
  combinedSubsidy: number,
  grantId: string | null,
  courseTypeLabel?: string | null
): GrantDeductionLine[] {
  if (combinedSubsidy <= 0) return [];
  const gid = grantId || '-';
  const label = labelForFamily(familyFromCourseType(courseTypeLabel));
  return [
    {
      amount: combinedSubsidy,
      grantId: gid,
      description: `Less: ${label} funding (Baseline)\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({ courseTypeLabel, fundingSchemeCode: 'BL' }),
    },
  ];
}

export function buildFallbackSplitGrantLines(opts: {
  blGrantId?: string | null;
  blAmount?: unknown;
  otherGrantId?: string | null;
  otherSchemeCode?: string | null;
  otherAmount?: unknown;
  totalGrantAmount?: unknown;
  grantIdFallback?: string | null;
  courseTypeLabel?: string | null;
}): GrantDeductionLine[] {
  const lines: GrantDeductionLine[] = [];
  const label = labelForFamily(familyFromCourseType(opts.courseTypeLabel));

  const blGrantId = String(opts.blGrantId || '').trim();
  if (blGrantId && isPositiveMoney(opts.blAmount)) {
    lines.push({
      amount: Number(opts.blAmount),
      grantId: blGrantId,
      description: `Less: ${label} funding (Baseline)\nGrant Ref#: ${blGrantId}`,
      itemName: resolveGrantItemName({ courseTypeLabel: opts.courseTypeLabel, fundingSchemeCode: 'BL' }),
    });
  }

  const otherGrantId = String(opts.otherGrantId || '').trim();
  if (otherGrantId && isPositiveMoney(opts.otherAmount)) {
    const scheme = String(opts.otherSchemeCode || 'Non-Baseline').trim() || 'Non-Baseline';
    lines.push({
      amount: Number(opts.otherAmount),
      grantId: otherGrantId,
      description: `Less: ${label} funding (${scheme})\nGrant Ref#: ${otherGrantId}`,
      itemName: resolveGrantItemName({
        courseTypeLabel: opts.courseTypeLabel,
        fundingSchemeCode: String(opts.otherSchemeCode || '').trim() || null,
        fundingSchemeDescription: scheme,
      }),
    });
  }

  if (lines.length > 0) return lines;

  return buildFallbackCombinedGrantLine(
    isPositiveMoney(opts.totalGrantAmount) ? Number(opts.totalGrantAmount) : 0,
    opts.grantIdFallback ?? null,
    opts.courseTypeLabel
  );
}

/**
 * Prefer split lines from DB; otherwise one combined line from DA fields.
 */
export async function resolveGrantDeductionLinesForInvoice(opts: {
  enrolmentId?: string | null;
  combinedSubsidy: number;
  grantIdFallback: string | null;
  /**
   * The enrolment's course type ('WSQ' | 'CASL' | 'IBF' | 'Non-WSQ'). Decides
   * which family of funding products the deductions bill against. Defaults to
   * WSQ, which is what every caller did before course type was consulted.
   */
  courseTypeLabel?: string | null;
}): Promise<{ lines: GrantDeductionLine[]; totalSubsidy: number }> {
  const { lines: dbLines, totalAmount } = await loadSplitGrantDeductionsFromDb(
    opts.enrolmentId,
    opts.courseTypeLabel
  );
  if (dbLines.length > 0) {
    return { lines: dbLines, totalSubsidy: totalAmount };
  }
  const fallback = buildFallbackCombinedGrantLine(
    opts.combinedSubsidy,
    opts.grantIdFallback,
    opts.courseTypeLabel
  );
  const totalSubsidy = fallback.reduce((s, l) => s + l.amount, 0);
  return { lines: fallback, totalSubsidy };
}
