import pool from '../db';
import { AnalyticsFilters, filteredEnrolmentsCte } from './filters';

export interface CourseRankingRow {
  key: string;
  label: string;
  courseType: string;
  enrolments: number;
  learners: number;
}

/**
 * Top 30 courses by active enrolments for the filter's period (the client
 * slices to Top N). Ignores the course slicer so the other courses stay
 * visible while one is selected.
 */
export async function loadCourseRanking(f: AnalyticsFilters): Promise<CourseRankingRow[]> {
  const params: unknown[] = [];
  const { rows } = await pool.query(
    `WITH ${filteredEnrolmentsCte(f, params, { period: true, ignore: ['course'] })}
     SELECT course_reference,
            MAX(course_title) AS course_title,
            MAX(course_type) AS course_type,
            COUNT(*) AS enrolments,
            COUNT(DISTINCT trainee_nric) AS learners
     FROM fe
     WHERE is_active AND course_reference IS NOT NULL
     GROUP BY course_reference
     ORDER BY enrolments DESC, learners DESC
     LIMIT 30`,
    params,
  );
  return rows.map((r) => ({
    key: r.course_reference as string,
    label: (r.course_title as string) || (r.course_reference as string),
    courseType: r.course_type as string,
    enrolments: Number(r.enrolments) || 0,
    learners: Number(r.learners) || 0,
  }));
}
