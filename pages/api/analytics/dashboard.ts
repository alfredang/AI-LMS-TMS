import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Get total unique learners enrolled across all course runs
    const totalLearnersResult = await pool.query(`
      SELECT COUNT(DISTINCT e.user_id) AS total_learners
      FROM enrollment e
      WHERE e.enrolment_status IS NULL OR LOWER(e.enrolment_status) != 'cancelled';
    `);

    // Get enrollment by month using created_at since enrolment_date is null
    const enrollmentByMonthResult = await pool.query(`
      SELECT 
        DATE_TRUNC('month', e.created_at) AS month,
        COUNT(DISTINCT e.user_id) AS total_learners
      FROM enrollment e
      WHERE e.created_at IS NOT NULL
      GROUP BY DATE_TRUNC('month', e.created_at)
      ORDER BY month;
    `);

    // Get top 10 courses by enrollment
    const courseRankingResult = await pool.query(`
      SELECT 
        c.id AS course_id,
        c.title AS course_title,
        COUNT(e.id) AS total_enrolments
      FROM course c
      JOIN enrollment e ON c.id = e.course_id
      GROUP BY c.id, c.title
      ORDER BY total_enrolments DESC
      LIMIT 10;
    `);

    // Get learner age groups using dateOfBirth from raw_data JSONB column
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
        SELECT DISTINCT ON (e.user_id)
          e.user_id,
          (e.raw_data->'trainee'->>'dateOfBirth')::date AS dob
        FROM enrollment e
        WHERE e.raw_data->'trainee'->>'dateOfBirth' IS NOT NULL
          AND e.raw_data->'trainee'->>'dateOfBirth' != ''
      ),
      learner_age_groups AS (
        SELECT
          user_id,
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
        COALESCE(COUNT(DISTINCT la.user_id), 0) AS unique_learners
      FROM age_ranges ar
      LEFT JOIN learner_age_groups la ON ar.age_group = la.age_group
      GROUP BY ar.age_group, ar.sort_order
      ORDER BY ar.sort_order;
    `);

    // Get enrolment status breakdown (Confirmed vs Cancelled)
    const enrolmentStatusResult = await pool.query(`
      SELECT
        CASE
          WHEN LOWER(e.enrolment_status) = 'confirmed' THEN 'Confirmed'
          WHEN LOWER(e.enrolment_status) = 'cancelled' THEN 'Cancelled'
          ELSE 'Other'
        END AS status,
        COUNT(DISTINCT e.user_id) AS total_learners
      FROM enrollment e
      WHERE e.enrolment_status IS NOT NULL
      GROUP BY 1
      ORDER BY 1;
    `);

    // Get sponsorship breakdown with all types
    const sponsorshipBreakdownResult = await pool.query(`
      WITH sponsorship_types AS (
        SELECT 'Employer' AS sponsorship_type
        UNION SELECT 'Individual'
        UNION SELECT 'N/A'
      ),
      enrollment_sponsorship AS (
        SELECT
          CASE
            WHEN e.course_sponsorship::text = 'Employer' THEN 'Employer'
            WHEN e.course_sponsorship::text = 'Individual' THEN 'Individual'
            ELSE 'N/A'
          END AS sponsorship_type,
          e.user_id
        FROM enrollment e
      )
      SELECT 
        st.sponsorship_type,
        COALESCE(COUNT(DISTINCT es.user_id), 0) AS total_learners
      FROM sponsorship_types st
      LEFT JOIN enrollment_sponsorship es ON st.sponsorship_type = es.sponsorship_type
      GROUP BY st.sponsorship_type
      ORDER BY st.sponsorship_type;
    `);


    // Format the data
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-based (0 = January, 9 = October)
    
    // Create all months up to current month
    const allMonths = [];
    for (let month = 0; month <= currentMonth; month++) {
      const monthDate = new Date(currentYear, month, 1);
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

    // Get enrollment forecast from upcoming classes (next 3 months)
    const enrollmentForecastResult = await pool.query(`
      SELECT COUNT(*) AS forecast_learners
      FROM enrollment e
      JOIN course_run cr ON e.course_run_id = cr.id
      WHERE cr.start_date > CURRENT_DATE
        AND cr.start_date <= CURRENT_DATE + INTERVAL '3 months';
    `);

    console.log('📊 Total learners query result:', totalLearnersResult.rows);
    console.log('📊 Enrollment forecast result:', enrollmentForecastResult.rows);

    const analyticsData = {
      totalLearners: parseInt(totalLearnersResult.rows[0]?.total_learners) || 0,
      totalGrants: 0, // As requested, set to 0 for now
      totalClaims: 0, // As requested, set to 0 for now
      enrollmentForecast: parseInt(enrollmentForecastResult.rows[0]?.forecast_learners) || 0,
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
      enrollmentByMonth: [],
      courseRanking: [],
      ageProfile: [],
      genderBreakdown: [],
      sponsorshipBreakdown: [],
      ethnicityBreakdown: []
    };
    
    res.status(200).json({
      success: true,
      data: fallbackData,
      warning: 'Using fallback data due to database error'
    });
  }
}