import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  CLAIM_AT,
  CLAIM_PAID_STATUSES,
  claimSegmentSql,
  COURSE_TYPES_CTE,
  filteredEnrolmentsCte,
  parseFilters,
  parseTrend,
  buildBuckets,
} from '../../../lib/analytics/filters';

/**
 * Time series for the Training Analytics trend charts.
 *
 * Query params: range=3m|6m|12m|24m|36m, granularity=week|month, plus the
 * segment slicers of /api/analytics/dashboard (courseType, sponsorship, course).
 *
 * learners   = unique learners enrolled in the bucket (cancelled excluded)
 * enrolments = enrolments in the bucket (cancelled excluded)
 * grants     = grant value (approved, else estimated; cancelled excluded) of enrolments in the bucket
 * claims     = claims paid out (Disbursed or Paid), by payout date
 */

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const f = parseFilters(req.query);
    const { range, granularity } = parseTrend(req.query);
    const buckets = buildBuckets(range, granularity);
    const start = buckets[0];
    // Fixed strings only — never user input.
    const unit = granularity === 'week' ? 'week' : 'month';
    const bucketOf = (expr: string) =>
      `to_char(date_trunc('${unit}', (${expr}) AT TIME ZONE 'Asia/Singapore'), 'YYYY-MM-DD')`;

    const pE: unknown[] = [];
    const enrolQ = pool.query(
      `WITH ${filteredEnrolmentsCte(f, pE, { period: false })}
       SELECT ${bucketOf('enrol_at')} AS b,
              COUNT(DISTINCT trainee_nric) FILTER (WHERE trainee_nric IS NOT NULL) AS learners,
              COUNT(*) AS enrolments
       FROM fe
       WHERE is_active AND enrol_at >= ($${pE.push(start)}::date - INTERVAL '7 days')
       GROUP BY 1`,
      pE,
    );

    const pG: unknown[] = [];
    const grantQ = pool.query(
      `WITH ${filteredEnrolmentsCte(f, pG, { period: false })}
       SELECT ${bucketOf('fe.enrol_at')} AS b,
              SUM(COALESCE(g.approved_grant_amount, g.estimated_grant_amount, 0)) AS total
       FROM ssg_grants g
       JOIN fe ON fe.enrolment_id = g.enrollment_id
       WHERE g.status <> 'Cancelled' AND fe.enrol_at >= ($${pG.push(start)}::date - INTERVAL '7 days')
       GROUP BY 1`,
      pG,
    );

    const pC: unknown[] = [];
    const claimSeg = claimSegmentSql(f, pC);
    const claimQ = pool.query(
      `WITH ${COURSE_TYPES_CTE}
       SELECT ${bucketOf(CLAIM_AT)} AS b, SUM(c.claim_amount) AS total
       FROM ssg_claims c
       ${claimSeg.joins}
       WHERE c.claim_status = ANY($${pC.push(CLAIM_PAID_STATUSES)}::text[])
         AND ${CLAIM_AT} >= ($${pC.push(start)}::date - INTERVAL '7 days')
         ${claimSeg.where.map((w) => `AND ${w}`).join(' ')}
       GROUP BY 1`,
      pC,
    );

    const [enrol, grant, claim] = await Promise.all([enrolQ, grantQ, claimQ]);
    const byKey = <T,>(rows: Array<Record<string, unknown>>, pick: (r: Record<string, unknown>) => T) =>
      new Map(rows.map((r) => [String(r.b), pick(r)]));
    const e = byKey(enrol.rows, (r) => ({ learners: Number(r.learners) || 0, enrolments: Number(r.enrolments) || 0 }));
    const g = byKey(grant.rows, (r) => Number(r.total) || 0);
    const c = byKey(claim.rows, (r) => Number(r.total) || 0);

    const series = buckets.map((b) => ({
      key: b,
      learners: e.get(b)?.learners ?? 0,
      enrolments: e.get(b)?.enrolments ?? 0,
      grants: g.get(b) ?? 0,
      claims: c.get(b) ?? 0,
    }));

    res.status(200).json({ success: true, data: { range, granularity, series } });
  } catch (error) {
    console.error('❌ Error fetching analytics trend:', error);
    res.status(500).json({ success: false, error: 'Failed to load analytics trend' });
  }
}

export default withAuth(handler);
