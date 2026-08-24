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
 * `family` defaults to WSQ so callers that predate the CASL split - Company
 * Application grant invoices - keep their exact previous behaviour.
 *
 * The scheme keyword matching itself lives in resolveFundingItemName, shared
 * with the course-line builder so the two can never drift apart.
 */
function resolveGrantItemName(opts: {
  family?: FundingFamily;
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
}): string {
  return resolveFundingItemName({
    family: opts.family || 'WSQ',
    fundingSchemeCode: opts.fundingSchemeCode,
    fundingSchemeDescription: opts.fundingSchemeDescription,
  });
}

/**
 * Loads up to two grant rows from `ssg_grants` for an SSG enrolment reference (ENR-...).
 */
export async function loadSplitGrantDeductionsFromDb(
  enrolmentId: string | null | undefined,
  family: FundingFamily = 'WSQ'
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
  // has to name the right scheme when it does, and it used to say WSQ for every
  // course, CASL included.
  const label = family === 'CASL' ? 'CASL' : 'WSQ';

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
        family,
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
        family,
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
  family: FundingFamily = 'WSQ'
): GrantDeductionLine[] {
  if (combinedSubsidy <= 0) return [];
  const gid = grantId || '-';
  return [
    {
      amount: combinedSubsidy,
      grantId: gid,
      description: `Less: ${family === 'CASL' ? 'CASL' : 'WSQ'} funding (Baseline)\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({ family, fundingSchemeCode: 'BL' }),
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
  family?: FundingFamily;
}): GrantDeductionLine[] {
  const family: FundingFamily = opts.family || 'WSQ';
  const label = family === 'CASL' ? 'CASL' : 'WSQ';
  const lines: GrantDeductionLine[] = [];

  const blGrantId = String(opts.blGrantId || '').trim();
  if (blGrantId && isPositiveMoney(opts.blAmount)) {
    lines.push({
      amount: Number(opts.blAmount),
      grantId: blGrantId,
      description: `Less: ${label} funding (Baseline)\nGrant Ref#: ${blGrantId}`,
      itemName: resolveGrantItemName({ family, fundingSchemeCode: 'BL' }),
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
        family,
        fundingSchemeCode: String(opts.otherSchemeCode || '').trim() || null,
        fundingSchemeDescription: scheme,
      }),
    });
  }

  if (lines.length > 0) return lines;

  return buildFallbackCombinedGrantLine(
    isPositiveMoney(opts.totalGrantAmount) ? Number(opts.totalGrantAmount) : 0,
    opts.grantIdFallback ?? null,
    family
  );
}

/**
 * Prefer split lines from DB; otherwise one combined line from DA fields.
 */
export async function resolveGrantDeductionLinesForInvoice(opts: {
  enrolmentId?: string | null;
  combinedSubsidy: number;
  grantIdFallback: string | null;
  /** Which funding products to bill against. Defaults to WSQ. */
  family?: FundingFamily;
}): Promise<{ lines: GrantDeductionLine[]; totalSubsidy: number }> {
  const family: FundingFamily = opts.family || 'WSQ';
  const { lines: dbLines, totalAmount } = await loadSplitGrantDeductionsFromDb(opts.enrolmentId, family);
  if (dbLines.length > 0) {
    return { lines: dbLines, totalSubsidy: totalAmount };
  }
  const fallback = buildFallbackCombinedGrantLine(opts.combinedSubsidy, opts.grantIdFallback, family);
  const totalSubsidy = fallback.reduce((s, l) => s + l.amount, 0);
  return { lines: fallback, totalSubsidy };
}
