import pool from '../db';
import { VENUE_COLUMNS, providerAddress, withVenue } from './venue';

// Caller identity comes exclusively from the verified session, never query parameters.
// includeCancelled: newer apps show cancelled classes in the class list with a status chip;
// older app versions (and the reminder sender) keep the list without them.
export async function mobileData(userId: string, role: string, opts: { includeCancelled?: boolean } = {}) {
  const trainer = role === 'trainer';
  const assignment = `(cr.assigned_trainer_id = $1 OR cr.tpg_assigned_trainer_id = $1 OR EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id=cr.id AND crt.trainer_id=$1))`;
  const enrollment = `EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id=cr.id AND e.user_id=$1 AND lower(coalesce(e.enrolment_status,'')) NOT IN ('cancelled','canceled','withdrawn'))`;
  const access = trainer ? `(${assignment} OR EXISTS (SELECT 1 FROM course_session cs WHERE cs.course_run_id=cr.id AND cs.trainer_id=$1 AND NOT coalesce(cs.deleted,false)))` : enrollment;
  const result = await pool.query(`SELECT cr.id::text, c.title, c.course_code AS code,
    cr.start_date::text AS "startDate", cr.end_date::text AS "endDate", cr.class_type AS format,
    cr.virtual_meeting_link AS "meetingURL", ${VENUE_COLUMNS},
    c.slides_url AS "slidesURL", c.learner_guide_url AS "guideURL", c.activities_url AS "activitiesURL",
    CASE WHEN $2::boolean THEN c.trainer_slides_url ELSE NULL END AS "trainerSlidesURL",
    cr.course_run_id AS "runCode", cr.class_status::text AS "classStatus"
    FROM course_run cr JOIN course c ON c.id=cr.course_id
    WHERE NOT coalesce(cr.is_deleted,false)
      AND (${opts.includeCancelled ? 'TRUE' : `lower(coalesce(cr.class_status::text,'')) NOT IN ('cancelled','canceled')`}) AND ${access}
    ORDER BY cr.start_date DESC NULLS LAST`,[userId,trainer]);
  const sessions = await pool.query(`SELECT cs.id::text, cr.id::text AS "courseID", c.title,
    cs.start_date AS "startDate", cs.end_date AS "endDate", cs.start_time AS "startTime", cs.end_time AS "endTime",
    coalesce(cs.title,cs.session_number,'Class session') AS subtitle,
    coalesce(cs.class_type,cr.class_type,'Physical') AS format, cr.virtual_meeting_link AS "meetingURL",
    ${VENUE_COLUMNS}
    FROM course_session cs JOIN course_run cr ON cr.id=cs.course_run_id JOIN course c ON c.id=cr.course_id
    WHERE NOT coalesce(cs.deleted,false) AND NOT coalesce(cr.is_deleted,false)
      AND lower(coalesce(cr.class_status::text,'')) NOT IN ('cancelled','canceled')
      AND ${trainer ? `(cs.trainer_id=$1 OR (cs.trainer_id IS NULL AND ${assignment}))` : enrollment}
    ORDER BY cs.start_date,cs.start_time`,[userId]);
  // Runs without published sessions still appear in the calendar with time TBC.
  // Never infer a 09:00 start or send a push for an unpublished time.
  const fallback = await pool.query(`SELECT ('run-'||cr.id::text) AS id, cr.id::text AS "courseID",c.title,
    cr.start_date::text AS "startDate",cr.end_date::text AS "endDate",NULL::text AS "startTime",NULL::text AS "endTime",
    'Session times to be confirmed' AS subtitle,cr.class_type AS format,cr.virtual_meeting_link AS "meetingURL",
    ${VENUE_COLUMNS}
    FROM course_run cr JOIN course c ON c.id=cr.course_id
    WHERE NOT coalesce(cr.is_deleted,false) AND lower(coalesce(cr.class_status::text,'')) NOT IN ('cancelled','canceled')
    AND ${trainer ? assignment : enrollment} AND NOT EXISTS(SELECT 1 FROM course_session cs WHERE cs.course_run_id=cr.id)`,[userId]);
  // Same venue address as the class page: the run's own street, else the academy's address.
  const address = await providerAddress();
  return { courses: withVenue(result.rows, address), sessions: withVenue([...sessions.rows,...fallback.rows], address) };
}
