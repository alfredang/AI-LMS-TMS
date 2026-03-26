import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Get total unique learners enrolled across all course runs (from SSG data)
    const totalLearnersResult = await pool.query(`
      SELECT COUNT(DISTINCT se.trainee_nric) AS total_learners
      FROM ssg_enrolments se
      WHERE se.trainee_nric IS NOT NULL
        AND (se.enrolment_status IS NULL OR LOWER(se.enrolment_status) != 'cancelled');
    `);

    // Get enrollment by month from SSG enrolment data
    const enrollmentByMonthResult = await pool.query(`
      SELECT
        DATE_TRUNC('month', COALESCE(se.enrolment_date, se.created_date)) AS month,
        COUNT(DISTINCT se.trainee_nric) AS total_learners
      FROM ssg_enrolments se
      WHERE se.trainee_nric IS NOT NULL
        AND (se.enrolment_status IS NULL OR LOWER(se.enrolment_status) != 'cancelled')
      GROUP BY DATE_TRUNC('month', COALESCE(se.enrolment_date, se.created_date))
      ORDER BY month;
    `);

    // Get top 10 courses by enrollment (from SSG data)
    const courseRankingResult = await pool.query(`
      SELECT
        se.course_reference AS course_id,
        se.course_title AS course_title,
        COUNT(*) AS total_enrolments
      FROM ssg_enrolments se
      WHERE se.enrolment_status IS NULL OR LOWER(se.enrolment_status) != 'cancelled'
      GROUP BY se.course_reference, se.course_title
      ORDER BY total_enrolments DESC
      LIMIT 10;
    `);

    // Get learner age groups using dateOfBirth from raw_data JSONB column (from SSG data)
    const ageGroupResult = await pool.query(`
      WITH age_ranges AS (
        SELECT '20-25' AS age_group, 1 AS sort_order
        UNION SELECT '26-30', 2
        UNION SELECT '31-35', 3
        UNION SELECT '36-40', 4
        UNION SELECT '41-45', 5
        UNION SELECT '46-50', 6
        UNION SELECT '51+', 7
      ),
      learner_ages AS (
        SELECT DISTINCT ON (se.trainee_nric)
          se.trainee_nric,
          (se.raw_data->'trainee'->>'dateOfBirth')::date AS dob
        FROM ssg_enrolments se
        WHERE se.raw_data->'trainee'->>'dateOfBirth' IS NOT NULL
          AND se.raw_data->'trainee'->>'dateOfBirth' != ''
          AND se.trainee_nric IS NOT NULL
      ),
      learner_age_groups AS (
        SELECT
          trainee_nric,
          CASE
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 20 AND 25 THEN '20-25'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 26 AND 30 THEN '26-30'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 31 AND 35 THEN '31-35'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 36 AND 40 THEN '36-40'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 41 AND 45 THEN '41-45'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) BETWEEN 46 AND 50 THEN '46-50'
            WHEN EXTRACT(YEAR FROM AGE(current_date, dob)) > 50 THEN '51+'
            ELSE NULL
          END AS age_group
        FROM learner_ages
      )
      SELECT
        ar.age_group,
        COALESCE(COUNT(DISTINCT la.trainee_nric), 0) AS unique_learners
      FROM age_ranges ar
      LEFT JOIN learner_age_groups la ON ar.age_group = la.age_group
      GROUP BY ar.age_group, ar.sort_order
      ORDER BY ar.sort_order;
    `);

    // Get enrolment status breakdown (Confirmed vs Cancelled) from SSG data
    const enrolmentStatusResult = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(se.enrolment_status) = 'confirmed' THEN 'Confirmed'
          WHEN LOWER(se.enrolment_status) = 'cancelled' THEN 'Cancelled'
          ELSE 'Other'
        END AS status,
        COUNT(DISTINCT se.trainee_nric) AS total_learners
      FROM ssg_enrolments se
      WHERE se.enrolment_status IS NOT NULL
        AND se.trainee_nric IS NOT NULL
      GROUP BY 1
      ORDER BY MIN(CASE
        WHEN LOWER(se.enrolment_status) = 'confirmed' THEN 1
        WHEN LOWER(se.enrolment_status) = 'cancelled' THEN 2
        ELSE 3
      END);
    `);

    // Get sponsorship breakdown (from SSG data) — Employer vs Individual only
    const sponsorshipBreakdownResult = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(se.sponsorship_type) = 'employer' THEN 'Employer'
          WHEN LOWER(se.sponsorship_type) = 'individual' THEN 'Individual'
        END AS sponsorship_type,
        COUNT(DISTINCT se.trainee_nric) AS total_learners
      FROM ssg_enrolments se
      WHERE se.trainee_nric IS NOT NULL
        AND LOWER(se.sponsorship_type) IN ('employer', 'individual')
      GROUP BY 1
      ORDER BY 1;
    `);


    // Format the data
    const currentDate = new Date();

    // Create last 12 months up to current month
    const allMonths = [];
    for (let i = 0; i <= 11; i++) {
      const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      allMonths.push({
        date: monthDate,
        label: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        value: 0
      });
    }
    
    // Fill in actual enrollment data
    const enrollmentDataMap = new Map();
    enrollmentByMonthResult.rows.forEach(row => {
      const monthDate = new Date(row.month);
      const label = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      enrollmentDataMap.set(label, parseInt(row.total_learners));
    });
    
    // Update all months with actual data
    allMonths.forEach(month => {
      if (enrollmentDataMap.has(month.label)) {
        month.value = enrollmentDataMap.get(month.label);
      }
    });

    // Enrollment forecast: trend-seasonal decomposition from SSG enrolment data
    const enrollmentForecastResult = await pool.query(`
      WITH source_months AS (
        SELECT
          EXTRACT(YEAR FROM COALESCE(se.enrolment_date, se.created_date))::int AS yr,
          EXTRACT(MONTH FROM COALESCE(se.enrolment_date, se.created_date))::int AS mo,
          COUNT(DISTINCT se.trainee_nric)::numeric AS total
        FROM ssg_enrolments se
        WHERE se.trainee_nric IS NOT NULL
          AND (se.enrolment_status IS NULL OR LOWER(se.enrolment_status) != 'cancelled')
          AND COALESCE(se.enrolment_date, se.created_date) IS NOT NULL
        GROUP BY yr, mo
      ),
      monthly_totals AS (
        SELECT yr, mo, total, (yr * 12 + mo) AS month_idx
        FROM source_months
      ),
      data_stats AS (
        SELECT COUNT(*) AS months_of_data, MIN(month_idx) AS min_idx, MAX(month_idx) AS max_idx
        FROM monthly_totals
      ),
      regression AS (
        SELECT COALESCE(regr_slope(total, month_idx), 0) AS slope,
               COALESCE(regr_intercept(total, month_idx), 0) AS intercept
        FROM monthly_totals
      ),
      overall_avg AS (
        SELECT COALESCE(AVG(total), 0) AS avg_total FROM monthly_totals
      ),
      seasonal_indices AS (
        SELECT mo, CASE WHEN oa.avg_total > 0 THEN AVG(mt.total) / oa.avg_total ELSE 1 END AS seasonal_idx
        FROM monthly_totals mt, overall_avg oa
        GROUP BY mo, oa.avg_total
      ),
      next_months AS (
        SELECT EXTRACT(MONTH FROM d)::int AS mo, EXTRACT(YEAR FROM d)::int AS yr,
               (EXTRACT(YEAR FROM d)::int * 12 + EXTRACT(MONTH FROM d)::int) AS month_idx
        FROM generate_series(
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month',
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '3 months',
          INTERVAL '1 month'
        ) AS d
      ),
      weighted_avg AS (
        SELECT CASE WHEN SUM(weight) > 0 THEN SUM(total * weight) / SUM(weight) * 3 ELSE 0 END AS forecast
        FROM (
          SELECT total, CASE WHEN month_idx > (SELECT max_idx - 2 FROM data_stats) THEN 2.0 ELSE 1.0 END AS weight
          FROM monthly_totals
        ) w
      ),
      trend_forecast AS (
        SELECT COALESCE(SUM(GREATEST(r.intercept + r.slope * nm.month_idx, 0)), 0) AS forecast
        FROM next_months nm, regression r
      ),
      full_forecast AS (
        SELECT COALESCE(SUM(GREATEST((r.intercept + r.slope * nm.month_idx) * COALESCE(si.seasonal_idx, 1), 0)), 0) AS forecast
        FROM next_months nm
        JOIN regression r ON true
        LEFT JOIN seasonal_indices si ON si.mo = nm.mo
      )
      SELECT
        ds.months_of_data,
        CASE
          WHEN ds.months_of_data = 0 THEN 0
          WHEN ds.months_of_data < 6 THEN wa.forecast
          WHEN ds.months_of_data < 12 THEN tf.forecast
          ELSE ff.forecast
        END AS forecast,
        CASE
          WHEN ds.months_of_data = 0 THEN 'none'
          WHEN ds.months_of_data < 6 THEN 'weighted avg'
          WHEN ds.months_of_data < 12 THEN 'trend'
          ELSE 'trend+seasonal'
        END AS method
      FROM data_stats ds, weighted_avg wa, trend_forecast tf, full_forecast ff;
    `);

    // Get total completed grants (paid amount)
    const totalGrantsResult = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(approved_grant_amount, 0)), 0) AS total_grants
      FROM ssg_grants
      WHERE status = 'Completed';
    `);

    // Get grants in pipeline (pending/processing)
    const grantsInPipelineResult = await pool.query(`
      SELECT COALESCE(SUM(COALESCE(estimated_grant_amount, 0)), 0) AS pipeline_grants
      FROM ssg_grants
      WHERE status NOT IN ('Completed', 'Cancelled');
    `);

    // Get total disbursed claims
    const totalClaimsResult = await pool.query(`
      SELECT COALESCE(SUM(claim_amount), 0) AS total_claims
      FROM ssg_claims
      WHERE claim_status = 'Disbursed';
    `);

    // Get claims in pipeline (approved/ready/pending, not cancelled/rejected/refunded)
    const claimsInPipelineResult = await pool.query(`
      SELECT COALESCE(SUM(claim_amount), 0) AS pipeline_claims
      FROM ssg_claims
      WHERE claim_status IN ('Approved', 'Ready for Payout', 'Pending', 'Pending Disbursement', 'To Be Disbursed');
    `);

    // Claim forecast: trend-seasonal decomposition from SSG claims data
    const claimForecastResult = await pool.query(`
      WITH source_months AS (
        SELECT
          EXTRACT(YEAR FROM TO_DATE(raw_data->>'Course Start Date', 'DD/MM/YYYY'))::int AS yr,
          EXTRACT(MONTH FROM TO_DATE(raw_data->>'Course Start Date', 'DD/MM/YYYY'))::int AS mo,
          SUM(COALESCE(claim_amount, 0)) AS total
        FROM ssg_claims
        WHERE claim_status NOT IN ('Cancelled', 'Rejected', 'Refunded')
          AND raw_data->>'Course Start Date' IS NOT NULL
          AND raw_data->>'Course Start Date' != ''
        GROUP BY yr, mo
      ),
      monthly_totals AS (
        SELECT yr, mo, total, (yr * 12 + mo) AS month_idx
        FROM source_months
      ),
      data_stats AS (
        SELECT COUNT(*) AS months_of_data, MIN(month_idx) AS min_idx, MAX(month_idx) AS max_idx
        FROM monthly_totals
      ),
      regression AS (
        SELECT COALESCE(regr_slope(total, month_idx), 0) AS slope,
               COALESCE(regr_intercept(total, month_idx), 0) AS intercept
        FROM monthly_totals
      ),
      overall_avg AS (
        SELECT COALESCE(AVG(total), 0) AS avg_total FROM monthly_totals
      ),
      seasonal_indices AS (
        SELECT mo, CASE WHEN oa.avg_total > 0 THEN AVG(mt.total) / oa.avg_total ELSE 1 END AS seasonal_idx
        FROM monthly_totals mt, overall_avg oa
        GROUP BY mo, oa.avg_total
      ),
      next_months AS (
        SELECT EXTRACT(MONTH FROM d)::int AS mo, EXTRACT(YEAR FROM d)::int AS yr,
               (EXTRACT(YEAR FROM d)::int * 12 + EXTRACT(MONTH FROM d)::int) AS month_idx
        FROM generate_series(
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month',
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '3 months',
          INTERVAL '1 month'
        ) AS d
      ),
      weighted_avg AS (
        SELECT CASE WHEN SUM(weight) > 0 THEN SUM(total * weight) / SUM(weight) * 3 ELSE 0 END AS forecast
        FROM (
          SELECT total, CASE WHEN month_idx > (SELECT max_idx - 2 FROM data_stats) THEN 2.0 ELSE 1.0 END AS weight
          FROM monthly_totals
        ) w
      ),
      trend_forecast AS (
        SELECT COALESCE(SUM(GREATEST(r.intercept + r.slope * nm.month_idx, 0)), 0) AS forecast
        FROM next_months nm, regression r
      ),
      full_forecast AS (
        SELECT COALESCE(SUM(GREATEST((r.intercept + r.slope * nm.month_idx) * COALESCE(si.seasonal_idx, 1), 0)), 0) AS forecast
        FROM next_months nm
        JOIN regression r ON true
        LEFT JOIN seasonal_indices si ON si.mo = nm.mo
      )
      SELECT
        ds.months_of_data,
        CASE
          WHEN ds.months_of_data = 0 THEN 0
          WHEN ds.months_of_data < 6 THEN wa.forecast
          WHEN ds.months_of_data < 12 THEN tf.forecast
          ELSE ff.forecast
        END AS forecast,
        CASE
          WHEN ds.months_of_data = 0 THEN 'none'
          WHEN ds.months_of_data < 6 THEN 'weighted avg'
          WHEN ds.months_of_data < 12 THEN 'trend'
          ELSE 'trend+seasonal'
        END AS method
      FROM data_stats ds, weighted_avg wa, trend_forecast tf, full_forecast ff;
    `);

    // Grant forecast: trend-seasonal decomposition from SSG grants data
    const grantForecastResult = await pool.query(`
      WITH source_months AS (
        SELECT
          (2000 + CAST(SUBSTRING(grant_id FROM 5 FOR 2) AS int)) AS yr,
          CAST(SUBSTRING(grant_id FROM 7 FOR 2) AS int) AS mo,
          SUM(COALESCE(approved_grant_amount, estimated_grant_amount, 0)) AS total
        FROM ssg_grants
        WHERE status != 'Cancelled'
          AND grant_id LIKE 'GRN-%'
        GROUP BY yr, mo
      ),
      monthly_totals AS (
        SELECT yr, mo, total, (yr * 12 + mo) AS month_idx
        FROM source_months
      ),
      data_stats AS (
        SELECT COUNT(*) AS months_of_data, MIN(month_idx) AS min_idx, MAX(month_idx) AS max_idx
        FROM monthly_totals
      ),
      regression AS (
        SELECT COALESCE(regr_slope(total, month_idx), 0) AS slope,
               COALESCE(regr_intercept(total, month_idx), 0) AS intercept
        FROM monthly_totals
      ),
      overall_avg AS (
        SELECT COALESCE(AVG(total), 0) AS avg_total FROM monthly_totals
      ),
      seasonal_indices AS (
        SELECT mo, CASE WHEN oa.avg_total > 0 THEN AVG(mt.total) / oa.avg_total ELSE 1 END AS seasonal_idx
        FROM monthly_totals mt, overall_avg oa
        GROUP BY mo, oa.avg_total
      ),
      next_months AS (
        SELECT EXTRACT(MONTH FROM d)::int AS mo, EXTRACT(YEAR FROM d)::int AS yr,
               (EXTRACT(YEAR FROM d)::int * 12 + EXTRACT(MONTH FROM d)::int) AS month_idx
        FROM generate_series(
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month',
          DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '3 months',
          INTERVAL '1 month'
        ) AS d
      ),
      weighted_avg AS (
        SELECT CASE WHEN SUM(weight) > 0 THEN SUM(total * weight) / SUM(weight) * 3 ELSE 0 END AS forecast
        FROM (
          SELECT total, CASE WHEN month_idx > (SELECT max_idx - 2 FROM data_stats) THEN 2.0 ELSE 1.0 END AS weight
          FROM monthly_totals
        ) w
      ),
      trend_forecast AS (
        SELECT COALESCE(SUM(GREATEST(r.intercept + r.slope * nm.month_idx, 0)), 0) AS forecast
        FROM next_months nm, regression r
      ),
      full_forecast AS (
        SELECT COALESCE(SUM(GREATEST((r.intercept + r.slope * nm.month_idx) * COALESCE(si.seasonal_idx, 1), 0)), 0) AS forecast
        FROM next_months nm
        JOIN regression r ON true
        LEFT JOIN seasonal_indices si ON si.mo = nm.mo
      )
      SELECT
        ds.months_of_data,
        CASE
          WHEN ds.months_of_data = 0 THEN 0
          WHEN ds.months_of_data < 6 THEN wa.forecast
          WHEN ds.months_of_data < 12 THEN tf.forecast
          ELSE ff.forecast
        END AS forecast,
        CASE
          WHEN ds.months_of_data = 0 THEN 'none'
          WHEN ds.months_of_data < 6 THEN 'weighted avg'
          WHEN ds.months_of_data < 12 THEN 'trend'
          ELSE 'trend+seasonal'
        END AS method
      FROM data_stats ds, weighted_avg wa, trend_forecast tf, full_forecast ff;
    `);

    const enrollmentForecastRow = enrollmentForecastResult.rows[0];
    const grantForecastRow = grantForecastResult.rows[0];
    const claimForecastRow = claimForecastResult.rows[0];

    const analyticsData = {
      totalLearners: parseInt(totalLearnersResult.rows[0]?.total_learners) || 0,
      totalGrants: parseFloat(totalGrantsResult.rows[0]?.total_grants) || 0,
      totalClaims: parseFloat(totalClaimsResult.rows[0]?.total_claims) || 0,
      enrollmentForecast: Math.round(parseFloat(enrollmentForecastRow?.forecast) || 0),
      grantForecast: parseFloat(grantForecastRow?.forecast) || 0,
      grantForecastMethod: grantForecastRow?.method || 'none',
      grantsInPipeline: parseFloat(grantsInPipelineResult.rows[0]?.pipeline_grants) || 0,
      claimForecast: parseFloat(claimForecastRow?.forecast) || 0,
      claimForecastMethod: claimForecastRow?.method || 'none',
      claimsInPipeline: parseFloat(claimsInPipelineResult.rows[0]?.pipeline_claims) || 0,
      enrollmentByMonth: allMonths.map(month => ({ label: month.label, value: month.value })),
      courseRanking: courseRankingResult.rows.map(row => ({
        label: row.course_title,
        value: parseInt(row.total_enrolments)
      })),
      ageProfile: ageGroupResult.rows.map(row => ({
        label: row.age_group,
        value: parseInt(row.unique_learners)
      })),
      enrolmentStatusBreakdown: enrolmentStatusResult.rows.map(row => ({
        label: row.status,
        value: parseInt(row.total_learners)
      })),
      sponsorshipBreakdown: sponsorshipBreakdownResult.rows.map(row => ({
        label: row.sponsorship_type,
        value: parseInt(row.total_learners)
      }))
    };

    console.log('✅ Analytics data fetched successfully');
    console.log('📊 Enrollment by month data:', enrollmentByMonthResult.rows);
    console.log('📊 Formatted enrollment data:', analyticsData.enrollmentByMonth);
    
    res.status(200).json({
      success: true,
      data: analyticsData
    });

  } catch (error) {
    console.error('❌ Error fetching analytics data:', error);
    
    // Return fallback data instead of error to ensure UI works
    const fallbackData = {
      totalLearners: 0,
      totalGrants: 0,
      totalClaims: 0,
      enrollmentForecast: 0,
      grantForecast: 0,
      grantForecastMethod: 'none',
      grantsInPipeline: 0,
      claimForecast: 0,
      claimForecastMethod: 'none',
      claimsInPipeline: 0,
      enrollmentByMonth: [],
      courseRanking: [],
      ageProfile: [],
      enrolmentStatusBreakdown: [],
      sponsorshipBreakdown: []
    };
    
    res.status(200).json({
      success: true,
      data: fallbackData,
      warning: 'Using fallback data due to database error'
    });
  }
}