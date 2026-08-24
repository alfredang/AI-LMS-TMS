import pool from '../db';

/**
 * Negative invoice lines for QuickBooks: Baseline and first Non-Baseline grant,
 * using the same row selection as consolidated finance (`all-course-runs`).
 */
export interface GrantDeductionLine {
  amount: number;
  grantId: string;
  /** Full Description field for QBO (includes Grant Ref#) */
  description: string;
  /** QB Item Name to use for this line (e.g. 'WSQ funding (Baseline)', 'WSQ funding (MCES)') */
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

function resolveGrantItemName(opts: {
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
  /** 'WSQ' | 'CASL' | 'IBF' | 'Non-WSQ' — the enrolment's actual course type. Defaults to 'WSQ' for existing DA/CA callers. */
  courseTypeLabel?: string | null;
}): string {
  const haystack = `${opts.fundingSchemeCode || ''} ${opts.fundingSchemeDescription || ''}`.toLowerCase();
  const type = String(opts.courseTypeLabel || '').trim() || 'WSQ';
  if (/baseline|\bbl\b/.test(haystack)) return `${type} funding (Baseline)`;

  const hasMces = /\bmces\b|mid-career enhanced subsidy/.test(haystack);
  const hasSme = /\bsme\b|\bsmes\b|enhanced training support for smes/.test(haystack);

  if (hasMces && hasSme) return `${type} funding (MCES/SME)`;
  if (hasMces) return `${type} funding (MCES)`;
  if (hasSme) return `${type} funding (SMEs)`;
  return `${type} funding (MCES/SME)`;
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
  const type = String(courseTypeLabel || '').trim() || 'WSQ';

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
      description: `Less: ${type} funding (Baseline)\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({
        fundingSchemeCode: bl.funding_scheme_code ?? 'Baseline',
        fundingSchemeDescription: bl.funding_scheme_description ?? 'Baseline',
        courseTypeLabel: type,
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
    const label = (nbl.funding_scheme_description || 'Non-Baseline').trim();
    lines.push({
      amount: Number(nbl.amt),
      grantId: gid,
      description: `Less: ${type} funding (${label})\nGrant Ref#: ${gid}`,
      itemName: resolveGrantItemName({
        fundingSchemeCode: nbl.funding_scheme_code,
        fundingSchemeDescription: nbl.funding_scheme_description,
        courseTypeLabel: type,
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
  const type = String(courseTypeLabel || '').trim() || 'WSQ';
  return [
    {
      amount: combinedSubsidy,
      grantId: gid,
      description: `Less: ${type} funding (Baseline)\nGrant Ref#: ${gid}`,
      itemName: `${type} funding (Baseline)`,
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
  const type = String(opts.courseTypeLabel || '').trim() || 'WSQ';

  const blGrantId = String(opts.blGrantId || '').trim();
  if (blGrantId && isPositiveMoney(opts.blAmount)) {
    lines.push({
      amount: Number(opts.blAmount),
      grantId: blGrantId,
      description: `Less: ${type} funding (Baseline)\nGrant Ref#: ${blGrantId}`,
      itemName: `${type} funding (Baseline)`,
    });
  }

  const otherGrantId = String(opts.otherGrantId || '').trim();
  if (otherGrantId && isPositiveMoney(opts.otherAmount)) {
    const label = String(opts.otherSchemeCode || 'Non-Baseline').trim() || 'Non-Baseline';
    lines.push({
      amount: Number(opts.otherAmount),
      grantId: otherGrantId,
      description: `Less: ${type} funding (${label})\nGrant Ref#: ${otherGrantId}`,
      itemName: resolveGrantItemName({
        fundingSchemeCode: String(opts.otherSchemeCode || '').trim() || null,
        fundingSchemeDescription: label,
        courseTypeLabel: type,
      }),
    });
  }

  if (lines.length > 0) return lines;

  return buildFallbackCombinedGrantLine(
    isPositiveMoney(opts.totalGrantAmount) ? Number(opts.totalGrantAmount) : 0,
    opts.grantIdFallback ?? null,
    type
  );
}

/**
 * Prefer split lines from DB; otherwise one combined line from DA fields.
 */
export async function resolveGrantDeductionLinesForInvoice(opts: {
  enrolmentId?: string | null;
  combinedSubsidy: number;
  grantIdFallback: string | null;
  /** 'WSQ' | 'CASL' | 'IBF' | 'Non-WSQ' — defaults to 'WSQ' for existing DA/CA callers. */
  courseTypeLabel?: string | null;
}): Promise<{ lines: GrantDeductionLine[]; totalSubsidy: number }> {
  const { lines: dbLines, totalAmount } = await loadSplitGrantDeductionsFromDb(opts.enrolmentId, opts.courseTypeLabel);
  if (dbLines.length > 0) {
    return { lines: dbLines, totalSubsidy: totalAmount };
  }
  const fallback = buildFallbackCombinedGrantLine(opts.combinedSubsidy, opts.grantIdFallback, opts.courseTypeLabel);
  const totalSubsidy = fallback.reduce((s, l) => s + l.amount, 0);
  return { lines: fallback, totalSubsidy };
}
