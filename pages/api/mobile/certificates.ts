import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';

/**
 * GET /api/mobile/certificates — the signed-in user's own course certificates, newest class first.
 *
 * One row per class the account is enrolled in (learners, and trainers who attended a course),
 * with the certificate link once it has been issued. The account comes from the session only,
 * never from the query. '__generating__' is the auto-create job's in-flight marker, not a link.
 */
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.status(405).end();
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  try {
    const rows = (await pool.query(
      `SELECT DISTINCT ON (cr.id)
              e.id::text AS id, cr.id::text AS "courseID", c.title,
              COALESCE(NULLIF(c.new_course_code,''), c.course_code) AS code,
              cr.course_run_id AS "runCode",
              cr.start_date::text AS "startDate", cr.end_date::text AS "endDate",
              e.assessment_status AS result,
              NULLIF(NULLIF(btrim(e.certificate),''), '__generating__') AS "certificateURL"
         FROM enrollment e
         JOIN course_run cr ON cr.id = e.course_run_id
         JOIN course c ON c.id = cr.course_id
        WHERE e.user_id = $1
          AND NOT coalesce(cr.is_deleted,false)
          AND lower(coalesce(e.enrolment_status,'')) NOT IN ('admin removed','cancelled','canceled','withdrawn')
        ORDER BY cr.id, (e.certificate IS NOT NULL AND e.certificate <> '__generating__') DESC`,
      [user.id]
    )).rows;
    rows.sort((a: any, b: any) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    // Only https links leave the server.
    const certificates = rows.map((r: any) => ({
      ...r,
      certificateURL: typeof r.certificateURL === 'string' && /^https:\/\//i.test(r.certificateURL) ? r.certificateURL : null,
    }));
    return res.json({ certificates });
  } catch {
    return res.status(500).json({ error: 'Your certificates could not be loaded. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
