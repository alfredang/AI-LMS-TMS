import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  AnalyticsFilters,
  CLAIM_AT,
  CLAIM_PAID_STATUSES,
  claimSegmentSql,
  COURSE_TYPES_CTE,
  filteredEnrolmentsCte,
  hasSegmentFilter,
  parseFilters,
  periodStart,
} from '../../../lib/analytics/filters';
import { forecastNext3Months, MonthlyTotal } from '../../../lib/analytics/forecast';

/**
 * Training Analytics dashboard data.
 *
 * Query params (all optional): period=all|ytd|3m|6m|12m|24m|36m,
 * courseType=<course.course_type>|Other, sponsorship=employer|individual,
 * course=<course reference>.
 *
 * Period applies to the actuals (KPIs, breakdowns). Pipelines and
 * forecasts use the full history but follow the other slicers. The Popular
 * Courses ranking has its own endpoint, /api/analytics/course-ranking. A breakdown
 * that is itself a slicer (course type, sponsorship) ignores
 * its own selection so the alternatives stay visible.
 */

const CLAIM_PIPELINE = ['Approved', 'Ready for Payout', 'Pending', 'Pending Disbursement', 'To Be Disbursed'];

const toMonthly = (
  rows: Array<{
    yr: string | number;
    mo: string | number;
    total: string | number;
  }>,
): MonthlyTotal[] =>
  rows
    .map((r) => ({
      yr: Number(r.yr),
      mo: Number(r.mo),
      total: Number(r.total) || 0,
    }))
    .filter((r) => r.yr > 2000 && r.mo >= 1 && r.mo <= 12);

async function loadDashboard(f: AnalyticsFilters) {
  const start = periodStart(f.period);
  const startIso = start ? start.toISOString().slice(0, 10) : null;
  const segment = hasSegmentFilter(f);

  // A: headline learners / enrolments
  const pA: unknown[] = [];
  const totalsQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pA, { period: true })}
     SELECT COUNT(DISTINCT trainee_nric) FILTER (WHERE is_active AND trainee_nric IS NOT NULL) AS learners,
            COUNT(*) FILTER (WHERE is_active) AS enrolments
     FROM fe`,
    pA,
  );

  // C: age profile (unique learners, age today)
  const pC: unknown[] = [];
  const ageQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pC, { period: true })},
     ages AS (
       SELECT DISTINCT ON (trainee_nric) trainee_nric, EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob)) AS age
       FROM fe WHERE dob IS NOT NULL AND trainee_nric IS NOT NULL
     ),
     buckets(age_group, sort_order, lo, hi) AS (
       VALUES ('20-25',1,20,25), ('26-30',2,26,30), ('31-35',3,31,35), ('36-40',4,36,40),
              ('41-45',5,41,45), ('46-50',6,46,50), ('51+',7,51,200)
     )
     SELECT b.age_group, COUNT(a.trainee_nric) AS learners
     FROM buckets b LEFT JOIN ages a ON a.age BETWEEN b.lo AND b.hi
     GROUP BY b.age_group, b.sort_order
     ORDER BY b.sort_order`,
    pC,
  );

  // D: enrolment status (unique learners)
  const pD: unknown[] = [];
  const statusQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pD, { period: true })}
     SELECT CASE WHEN LOWER(enrolment_status) = 'confirmed' THEN 'Confirmed'
                 WHEN LOWER(enrolment_status) = 'cancelled' THEN 'Cancelled'
                 ELSE 'Other' END AS status,
            COUNT(DISTINCT trainee_nric) AS learners
     FROM fe
     WHERE enrolment_status IS NOT NULL AND trainee_nric IS NOT NULL
     GROUP BY 1
     ORDER BY MIN(CASE WHEN LOWER(enrolment_status) = 'confirmed' THEN 1
                       WHEN LOWER(enrolment_status) = 'cancelled' THEN 2 ELSE 3 END)`,
    pD,
  );

  // E: sponsorship (ignores its own slicer)
  const pE: unknown[] = [];
  const sponsorshipQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pE, { period: true, ignore: ['sponsorship'] })}
     SELECT LOWER(sponsorship_type) AS key, COUNT(DISTINCT trainee_nric) AS learners
     FROM fe
     WHERE trainee_nric IS NOT NULL AND LOWER(sponsorship_type) IN ('employer', 'individual')
     GROUP BY 1
     ORDER BY 1`,
    pE,
  );

  // F: course type mix (ignores its own slicer)
  const pF: unknown[] = [];
  const typeMixQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pF, { period: true, ignore: ['courseType'] })}
     SELECT course_type AS key,
            COUNT(DISTINCT trainee_nric) FILTER (WHERE trainee_nric IS NOT NULL) AS learners,
            COUNT(*) AS enrolments
     FROM fe
     WHERE is_active
     GROUP BY 1
     ORDER BY enrolments DESC`,
    pF,
  );

  // G: grants — approved (Completed) in period + pipeline (all time)
  const pG: unknown[] = [];
  const grantCte = filteredEnrolmentsCte(f, pG, { period: false });
  let grantPeriod = 'TRUE';
  if (startIso) {
    pG.push(startIso);
    grantPeriod = `fe.enrol_at >= $${pG.length}::date`;
  }
  const grantsQ = pool.query(
    `WITH ${grantCte}
     SELECT
       COALESCE(SUM(COALESCE(g.approved_grant_amount, 0)) FILTER (WHERE g.status = 'Completed' AND ${grantPeriod}), 0) AS total,
       COALESCE(SUM(COALESCE(g.estimated_grant_amount, 0)) FILTER (WHERE g.status NOT IN ('Completed', 'Cancelled')), 0) AS pipeline
     FROM ssg_grants g
     ${segment ? 'JOIN' : 'LEFT JOIN'} fe ON fe.enrolment_id = g.enrollment_id`,
    pG,
  );

  // H: claims — paid out in period + pipeline (all time)
  const pH: unknown[] = [];
  const claimSeg = claimSegmentSql(f, pH);
  let claimPeriod = 'TRUE';
  if (startIso) {
    pH.push(startIso);
    claimPeriod = `${CLAIM_AT} >= $${pH.length}::date`;
  }
  pH.push(CLAIM_PAID_STATUSES);
  const paidParam = `$${pH.length}`;
  pH.push(CLAIM_PIPELINE);
  const pipelineParam = `$${pH.length}`;
  const claimsQ = pool.query(
    `WITH ${COURSE_TYPES_CTE}
     SELECT
       COALESCE(SUM(c.claim_amount) FILTER (WHERE c.claim_status = ANY(${paidParam}::text[]) AND ${claimPeriod}), 0) AS total,
       COALESCE(SUM(c.claim_amount) FILTER (WHERE c.claim_status = ANY(${pipelineParam}::text[])), 0) AS pipeline
     FROM ssg_claims c
     ${claimSeg.joins}
     ${claimSeg.where.length ? `WHERE ${claimSeg.where.join(' AND ')}` : ''}`,
    pH,
  );

  // I-K: monthly series for the forecasts (full history, segment slicers only)
  const pI: unknown[] = [];
  const enrolSeriesQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pI, { period: false })}
     SELECT EXTRACT(YEAR FROM enrol_at)::int AS yr, EXTRACT(MONTH FROM enrol_at)::int AS mo,
            COUNT(DISTINCT trainee_nric) AS total
     FROM fe
     WHERE trainee_nric IS NOT NULL AND is_active AND enrol_at IS NOT NULL
     GROUP BY 1, 2`,
    pI,
  );

  const pJ: unknown[] = [];
  const grantSeriesQ = pool.query(
    `WITH ${filteredEnrolmentsCte(f, pJ, { period: false })}
     SELECT (2000 + CAST(SUBSTRING(g.grant_id FROM 5 FOR 2) AS int)) AS yr,
            CAST(SUBSTRING(g.grant_id FROM 7 FOR 2) AS int) AS mo,
            SUM(COALESCE(g.approved_grant_amount, g.estimated_grant_amount, 0)) AS total
     FROM ssg_grants g
     ${segment ? 'JOIN' : 'LEFT JOIN'} fe ON fe.enrolment_id = g.enrollment_id
     WHERE g.status <> 'Cancelled' AND g.grant_id ~ '^GRN-\\d{4}'
     GROUP BY 1, 2`,
    pJ,
  );

  const pK: unknown[] = [];
  const claimSeriesSeg = claimSegmentSql(f, pK);
  const claimSeriesQ = pool.query(
    `WITH ${COURSE_TYPES_CTE},
     cs AS (
       SELECT TO_DATE(c.raw_data->>'Course Start Date', 'DD/MM/YYYY') AS d, COALESCE(c.claim_amount, 0) AS amt
       FROM ssg_claims c
       ${claimSeriesSeg.joins}
       WHERE c.claim_status NOT IN ('Cancelled', 'Rejected', 'Refunded')
         AND c.raw_data->>'Course Start Date' ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$'
         ${claimSeriesSeg.where.map((w) => `AND ${w}`).join(' ')}
     )
     SELECT EXTRACT(YEAR FROM d)::int AS yr, EXTRACT(MONTH FROM d)::int AS mo, SUM(amt) AS total
     FROM cs GROUP BY 1, 2`,
    pK,
  );

  const [totals, age, status, sponsorship, typeMix, grants, claims, enrolSeries, grantSeries, claimSeries] =
    await Promise.all([
      totalsQ,
      ageQ,
      statusQ,
      sponsorshipQ,
      typeMixQ,
      grantsQ,
      claimsQ,
      enrolSeriesQ,
      grantSeriesQ,
      claimSeriesQ,
    ]);

  const enrolF = forecastNext3Months(toMonthly(enrolSeries.rows));
  const grantF = forecastNext3Months(toMonthly(grantSeries.rows));
  const claimF = forecastNext3Months(toMonthly(claimSeries.rows));

  const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return {
    filters: { ...f, periodStart: startIso },
    totalLearners: Number(totals.rows[0]?.learners) || 0,
    totalEnrolments: Number(totals.rows[0]?.enrolments) || 0,
    totalGrants: Number(grants.rows[0]?.total) || 0,
    grantsInPipeline: Number(grants.rows[0]?.pipeline) || 0,
    totalClaims: Number(claims.rows[0]?.total) || 0,
    claimsInPipeline: Number(claims.rows[0]?.pipeline) || 0,
    enrollmentForecast: Math.round(enrolF.value),
    enrollmentForecastMethod: enrolF.method,
    grantForecast: grantF.value,
    grantForecastMethod: grantF.method,
    claimForecast: claimF.value,
    claimForecastMethod: claimF.method,
    ageProfile: age.rows.map((r) => ({
      key: r.age_group,
      label: r.age_group,
      value: Number(r.learners) || 0,
    })),
    enrolmentStatusBreakdown: status.rows.map((r) => ({
      key: r.status,
      label: r.status,
      value: Number(r.learners) || 0,
    })),
    sponsorshipBreakdown: sponsorship.rows.map((r) => ({
      key: r.key,
      label: label(r.key),
      value: Number(r.learners) || 0,
    })),
    courseTypeMix: typeMix.rows.map((r) => ({
      key: r.key,
      label: r.key === 'Other' ? 'Other / not in LMS' : r.key,
      value: Number(r.learners) || 0,
      enrolments: Number(r.enrolments) || 0,
    })),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const data = await loadDashboard(parseFilters(req.query));
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ Error fetching analytics data:', error);
    res.status(500).json({ success: false, error: 'Failed to load analytics data' });
  }
}

export default withAuth(handler);
