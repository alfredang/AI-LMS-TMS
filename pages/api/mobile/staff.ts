import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { VENUE_COLUMNS, providerAddress, withVenue } from '../../../lib/mobile/venue';
import { normalizeSgPhone } from '../../../lib/trainerWhatsapp';

// Staff views for the TIA TMS apps (read-only).
//   GET ?view=classes&from=YYYY-MM-DD&to=YYYY-MM-DD   admin: every class run overlapping the dates,
//                                                     with trainers, learner count and status
//                                                     (Current, Upcoming and the admin calendar)
//   GET ?view=courses                                 admin / developer: the course catalogue
//   GET ?view=runs&courseId=<id>                      admin: every run of one course (newest
//                                                     first) with its status and trainers
//   GET ?view=trainers                                admin: trainers with a WhatsApp number, so
//                                                     the admin can message one about a class
// Writes (class status, trainer assignment) stay on the website, where SSG is updated.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (req.method !== 'GET') return res.status(405).end();
  if (user.isService) return res.status(403).end();
  const isAdmin = user.roles.has('admin');
  const isDeveloper = user.roles.has('developer');
  const view = String(req.query.view || '');

  try {
    if (view === 'classes') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      if (!DAY.test(from) || !DAY.test(to) || from > to) return res.status(400).json({ error: 'Choose a date range.' });
      // At most about three months at a time keeps the reply small on a phone.
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 100) return res.status(400).json({ error: 'Choose up to 3 months.' });
      const rows = (await pool.query(
        `SELECT cr.id::text, cr.course_run_id AS "runCode", c.title,
                coalesce(nullif(c.new_course_code,''), c.course_code) AS code,
                cr.start_date::text AS "startDate", cr.end_date::text AS "endDate",
                cr.class_type AS format, cr.class_status::text AS "classStatus",
                (cr.virtual_meeting_link IS NOT NULL AND cr.virtual_meeting_link <> '') AS "hasMeetingLink",
                coalesce(
                  (SELECT array_agg(DISTINCT crt.trainer_name ORDER BY crt.trainer_name)
                     FROM course_run_trainer crt
                    WHERE crt.course_run_id = cr.id AND nullif(crt.trainer_name,'') IS NOT NULL),
                  CASE WHEN nullif(cr.assigned_trainer_name,'') IS NOT NULL THEN ARRAY[cr.assigned_trainer_name] END,
                  CASE WHEN nullif(cr.tpg_assigned_trainer_name,'') IS NOT NULL THEN ARRAY[cr.tpg_assigned_trainer_name] END,
                  ARRAY[]::text[]
                ) AS trainers,
                (SELECT count(*)::int FROM enrollment e
                  WHERE e.course_run_id = cr.id
                    AND lower(coalesce(e.enrolment_status,'')) NOT IN ('cancelled','canceled','withdrawn')) AS learners,
                ${VENUE_COLUMNS}
           FROM course_run cr JOIN course c ON c.id = cr.course_id
          WHERE NOT coalesce(cr.is_deleted,false)
            AND cr.start_date <= $2::date AND coalesce(cr.end_date, cr.start_date) >= $1::date
          ORDER BY cr.start_date, c.title
          LIMIT 1500`,
        [from, to]
      )).rows;
      return res.json({ classes: withVenue(rows, await providerAddress()) });
    }

    if (view === 'courses') {
      if (!isAdmin && !isDeveloper) return res.status(403).json({ error: 'Admin or developer only' });
      const rows = (await pool.query(
        `SELECT c.id::text, c.title, coalesce(nullif(c.new_course_code,''), c.course_code) AS code,
                c.course_type AS "courseType", c.status, c.tsc_title AS "tscTitle", c.tsc_code AS "tscCode",
                c.training_hours::float AS "trainingHours", c.assessment_hours::float AS "assessmentHours",
                (SELECT left(h.valid_from::text, 10) FROM course_code_history h
                  WHERE h.course_id = c.id AND h.is_current LIMIT 1) AS "fundingValidityStart",
                left(c.funding_validity::text, 10) AS "fundingValidityEnd",
                (SELECT count(*)::int FROM course_run cr
                  WHERE cr.course_id = c.id AND NOT coalesce(cr.is_deleted,false)
                    AND cr.start_date >= current_date
                    AND lower(coalesce(cr.class_status::text,'')) NOT IN ('cancelled','canceled')) AS "upcomingRuns",
                (SELECT min(cr.start_date)::text FROM course_run cr
                  WHERE cr.course_id = c.id AND NOT coalesce(cr.is_deleted,false)
                    AND cr.start_date >= current_date
                    AND lower(coalesce(cr.class_status::text,'')) NOT IN ('cancelled','canceled')) AS "nextRun",
                coalesce(rc.total, 0) AS "totalRuns", coalesce(rc.confirmed, 0) AS "confirmedRuns",
                coalesce(rc.pending, 0) AS "pendingRuns", coalesce(rc.cancelled, 0) AS "cancelledRuns"
           FROM course c
           LEFT JOIN (
             SELECT cr.course_id,
                    count(*)::int AS total,
                    (count(*) FILTER (WHERE lower(cr.class_status::text) = 'confirmed'))::int AS confirmed,
                    (count(*) FILTER (WHERE lower(cr.class_status::text) LIKE 'cancel%'))::int AS cancelled,
                    (count(*) FILTER (WHERE lower(coalesce(cr.class_status::text,'')) <> 'confirmed'
                                        AND lower(coalesce(cr.class_status::text,'')) NOT LIKE 'cancel%'))::int AS pending
               FROM course_run cr WHERE NOT coalesce(cr.is_deleted,false) GROUP BY cr.course_id
           ) rc ON rc.course_id = c.id
          ORDER BY c.title
          LIMIT 3000`
      )).rows;
      return res.json({ courses: rows });
    }

    if (view === 'runs') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const courseId = String(req.query.courseId || '');
      if (!/^[0-9a-f-]{36}$/i.test(courseId)) return res.status(400).json({ error: 'Choose a course.' });
      const rows = (await pool.query(
        `SELECT cr.id::text, cr.course_run_id AS "runCode", c.title,
                coalesce(nullif(c.new_course_code,''), c.course_code) AS code,
                cr.start_date::text AS "startDate", cr.end_date::text AS "endDate",
                cr.class_type AS format, cr.class_status::text AS "classStatus",
                (cr.virtual_meeting_link IS NOT NULL AND cr.virtual_meeting_link <> '') AS "hasMeetingLink",
                coalesce(
                  (SELECT array_agg(DISTINCT crt.trainer_name ORDER BY crt.trainer_name)
                     FROM course_run_trainer crt
                    WHERE crt.course_run_id = cr.id AND nullif(crt.trainer_name,'') IS NOT NULL),
                  CASE WHEN nullif(cr.assigned_trainer_name,'') IS NOT NULL THEN ARRAY[cr.assigned_trainer_name] END,
                  CASE WHEN nullif(cr.tpg_assigned_trainer_name,'') IS NOT NULL THEN ARRAY[cr.tpg_assigned_trainer_name] END,
                  ARRAY[]::text[]
                ) AS trainers,
                (SELECT count(*)::int FROM enrollment e
                  WHERE e.course_run_id = cr.id
                    AND lower(coalesce(e.enrolment_status,'')) NOT IN ('cancelled','canceled','withdrawn')) AS learners,
                ${VENUE_COLUMNS}
           FROM course_run cr JOIN course c ON c.id = cr.course_id
          WHERE cr.course_id = $1::uuid AND NOT coalesce(cr.is_deleted,false)
          ORDER BY cr.start_date DESC NULLS LAST, cr.course_run_id DESC
          LIMIT 500`,
        [courseId]
      )).rows;
      return res.json({ classes: withVenue(rows, await providerAddress()) });
    }

    if (view === 'trainers') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const rows = (await pool.query(
        `SELECT au.full_name AS name, au.email, tp.tel
           FROM trainer_profile tp JOIN app_user au ON au.id = tp.user_id
          WHERE nullif(btrim(au.full_name),'') IS NOT NULL
            AND (au.account_status IS NULL OR lower(au.account_status) = 'active')
          ORDER BY au.full_name`
      )).rows;
      return res.json({
        trainers: rows.map((r: any) => ({ name: r.name, email: r.email || null, phone: normalizeSgPhone(r.tel) })),
      });
    }

    return res.status(400).json({ error: 'Unknown view' });
  } catch {
    return res.status(500).json({ error: 'This list could not be loaded. Please try again.' });
  }
}, { roles: ['admin', 'developer'] });
