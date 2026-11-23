import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';

/**
 * GET /api/mobile/hours — the signed-in trainer's training hours, all time.
 *
 * The TIA TMS apps group the rows by month. Hours per class are the course's
 * training + assessment hours, as on the web Training Hours page. Only CONFIRMED
 * classes that have ended (Singapore time) count; cancelled, pending and deleted
 * runs do not. A class counts for this trainer on the same assignment rules as the
 * app's calendar (/api/mobile/dashboard). The trainer comes from the session only,
 * never from the query (unlike /api/courses/trainer-hours).
 */
export default withAuth(
  async (req: AuthedApiRequest, res: NextApiResponse) => {
    if (req.method !== 'GET') return res.status(405).end();
    const user = req.authUser!;
    if (user.isService || !user.roles.has('trainer')) {
      return res.status(403).json({ error: 'Trainer access required' });
    }
    try {
      const result = await pool.query(
        `SELECT cr.id::text AS id, c.title,
           COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS code,
           cr.course_run_id AS "runCode",
           cr.start_date::text AS "startDate", cr.end_date::text AS "endDate",
           COALESCE(c.training_hours, 0)::float8 AS "trainingHours",
           COALESCE(c.assessment_hours, 0)::float8 AS "assessmentHours"
         FROM course_run cr JOIN course c ON c.id = cr.course_id
         WHERE NOT COALESCE(cr.is_deleted, false)
           AND cr.class_status = 'Confirmed'
           AND cr.start_date IS NOT NULL AND cr.end_date IS NOT NULL
           AND cr.end_date <= (now() AT TIME ZONE 'Asia/Singapore')::date
           AND (cr.assigned_trainer_id = $1 OR cr.tpg_assigned_trainer_id = $1
             OR EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id AND crt.trainer_id = $1)
             OR EXISTS (SELECT 1 FROM course_session cs WHERE cs.course_run_id = cr.id AND cs.trainer_id = $1 AND NOT COALESCE(cs.deleted, false)))
         ORDER BY cr.start_date DESC, c.title`,
        [user.id],
      );
      const rows = result.rows.map((r: any) => ({
        ...r,
        trainingHours: Number(r.trainingHours) || 0,
        assessmentHours: Number(r.assessmentHours) || 0,
      }));
      const training = rows.reduce((s: number, r: any) => s + r.trainingHours, 0);
      const assessment = rows.reduce((s: number, r: any) => s + r.assessmentHours, 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        data: rows,
        summary: {
          classes: rows.length,
          trainingHours: training,
          assessmentHours: assessment,
          totalHours: training + assessment,
        },
      });
    } catch {
      return res.status(500).json({ error: 'Unable to load your training hours. Please try again.' });
    }
  },
  { roles: ['trainer'] },
);
