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
}

/**
 * Loads up to two grant rows from `ssg_grants` for an SSG enrolment reference (ENR-…).
 */
export async function loadSplitGrantDeductionsFromDb(
  enrolmentId: string | null | undefined
): Promise<{ lines: GrantDeductionLine[]; totalAmount: number }> {
  const ref = String(enrolmentId || '').trim();
  if (!ref) return { lines: [], totalAmount: 0 };

  const [blRes, nblRes] = await Promise.all([
    pool.query(
      `SELECT grant_id,
             (CASE
               WHEN COALESCE(NULLIF(approved_grant_amount, ''), '0')::float > 0
                 THEN COALESCE(NULLIF(approved_grant_amount, ''), '0')::float
               ELSE COALESCE(NULLIF(estimated_grant_amount, ''), '0')::float
             END) AS amt,
              funding_scheme_description
       FROM ssg_grants
       WHERE LOWER(TRIM(COALESCE(enrollment_id, ''))) = LOWER(TRIM($1::text))
         AND funding_scheme_code = 'Baseline'
       ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
       LIMIT 1`,
      [ref]
    ),
    pool.query(
      `SELECT grant_id,
             (CASE
               WHEN COALESCE(NULLIF(approved_grant_amount, ''), '0')::float > 0
                 THEN COALESCE(NULLIF(approved_grant_amount, ''), '0')::float
               ELSE COALESCE(NULLIF(estimated_grant_amount, ''), '0')::float
             END) AS amt,
              funding_scheme_description,
              funding_scheme_code
       FROM ssg_grants
       WHERE LOWER(TRIM(COALESCE(enrollment_id, ''))) = LOWER(TRIM($1::text))
         AND COALESCE(funding_scheme_code, '') <> 'Baseline'
       ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
       LIMIT 1`,
      [ref]
    ),
  ]);

  const lines: GrantDeductionLine[] = [];

  const bl = blRes.rows[0] as { grant_id?: string; amt?: number } | undefined;
  if (bl && Number(bl.amt) > 0) {
    const gid = String(bl.grant_id ?? '—');
    lines.push({
      amount: Number(bl.amt),
      grantId: gid,
      description: `Less: WSQ funding (Baseline)\nGrant Ref#: ${gid}`,
    });
  }

  const nbl = nblRes.rows[0] as {
    grant_id?: string;
    amt?: number;
    funding_scheme_description?: string | null;
  } | undefined;
  if (nbl && Number(nbl.amt) > 0) {
    const gid = String(nbl.grant_id ?? '—');
    const label = (nbl.funding_scheme_description || 'Non-Baseline').trim();
    lines.push({
      amount: Number(nbl.amt),
      grantId: gid,
      description: `Less: WSQ funding (${label})\nGrant Ref#: ${gid}`,
    });
  }

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, totalAmount };
}

/** Legacy single line when `ssg_grants` has not been populated yet. */
export function buildFallbackCombinedGrantLine(
  combinedSubsidy: number,
  grantId: string | null
): GrantDeductionLine[] {
  if (combinedSubsidy <= 0) return [];
  const gid = grantId || '—';
  return [
    {
      amount: combinedSubsidy,
      grantId: gid,
      description: `Less: WSQ funding (Baseline)\nGrant Ref#: ${gid}`,
    },
  ];
}

/**
 * Prefer split lines from DB; otherwise one combined line from DA fields.
 */
export async function resolveGrantDeductionLinesForInvoice(opts: {
  enrolmentId?: string | null;
  combinedSubsidy: number;
  grantIdFallback: string | null;
}): Promise<{ lines: GrantDeductionLine[]; totalSubsidy: number }> {
  const { lines: dbLines, totalAmount } = await loadSplitGrantDeductionsFromDb(opts.enrolmentId);
  if (dbLines.length > 0) {
    return { lines: dbLines, totalSubsidy: totalAmount };
  }
  const fallback = buildFallbackCombinedGrantLine(opts.combinedSubsidy, opts.grantIdFallback);
  const totalSubsidy = fallback.reduce((s, l) => s + l.amount, 0);
  return { lines: fallback, totalSubsidy };
}
