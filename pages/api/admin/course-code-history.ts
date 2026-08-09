import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * Read-only view of every code each course has carried, so it is possible to
 * see at a glance which funding renewals have landed without querying the DB.
 *
 * Optional ?q= filters on title or on any code in the course's history.
 */
interface CodeEntry {
  code: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
}

interface CourseCodeRow {
  courseId: string;
  title: string;
  courseType: string | null;
  fundingValidity: string | null;
  fundingValid: boolean | null;
  enrolments: number;
  runs: number;
  codes: CodeEntry[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const renewedOnly = req.query.renewedOnly === '1' || req.query.renewedOnly === 'true';

  try {
    const { rows } = await pool.query(
      `SELECT c.id::text                AS course_id,
              c.title,
              c.course_type::text       AS course_type,
              c.funding_validity,
              CASE WHEN NULLIF(c.funding_validity,'') IS NULL THEN NULL
                   ELSE c.funding_validity::date > CURRENT_DATE END AS funding_valid,
              (SELECT count(*) FROM public.enrollment e WHERE e.course_id = c.id)::int  AS enrolments,
              (SELECT count(*) FROM public.course_run r WHERE r.course_id = c.id)::int  AS runs,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'code',       h.code,
                         'isCurrent',  h.is_current,
                         'validFrom',  h.valid_from,
                         'validTo',    h.valid_to)
                       ORDER BY h.is_current, h.valid_from NULLS FIRST, h.code)
                  FROM public.course_code_history h
                 WHERE h.course_id = c.id), '[]'::json)                                 AS codes,
              (SELECT count(*) FROM public.course_code_history h WHERE h.course_id = c.id)::int AS n_codes
         FROM public.course c
        WHERE ($1 = '' OR c.title ILIKE '%'||$1||'%'
               OR EXISTS (SELECT 1 FROM public.course_code_history h
                           WHERE h.course_id = c.id AND h.code ILIKE '%'||$1||'%'))
        ORDER BY c.title`,
      [q]
    );

    const courses: CourseCodeRow[] = rows
      .filter(r => !renewedOnly || r.n_codes > 1)
      .map(r => ({
        courseId: r.course_id,
        title: r.title,
        courseType: r.course_type,
        fundingValidity: r.funding_validity,
        fundingValid: r.funding_valid,
        enrolments: r.enrolments,
        runs: r.runs,
        codes: r.codes as CodeEntry[],
      }));

    return res.status(200).json({
      total: courses.length,
      renewed: courses.filter(c => c.codes.length > 1).length,
      courses,
    });
  } catch (error: any) {
    console.error('Failed to load course code history:', error);
    return res.status(500).json({ message: error.message || 'Failed to load' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
