import pool from '../db';
import { isAssignedTrainer } from '../auth/courseRunAccess';
import { labelSessions, toIsoDate } from '../attendance/sessionLabel';
import { ensureMobileSchema } from './schema';

// Shared logic behind the learner/trainer app routes (/api/mobile/*), used by both the iOS
// and the Android app. Rule for everything here: the caller's identity is the verified
// session user passed in by the route. No id from the request body or query string is
// trusted until it has been checked against that user's enrolment or trainer assignment.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MobileRole = 'learner' | 'trainer';

const ACTIVE_ENROLMENT = `lower(coalesce(e.enrolment_status,'')) NOT IN ('admin removed','cancelled','canceled','withdrawn')`;
const TRAQOM_URL = 'https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr';
const METHODS: [string, string][] = [
  ['writtenAssessment', 'Written Assessment'], ['practicalExam', 'Practical Performance'],
  ['caseStudy', 'Case Study'], ['rolePlay', 'Role Play'], ['oralQuestioning', 'Oral Questioning'],
  ['project', 'Project'], ['assignment', 'Assignment'],
];
export const METHOD_KEYS = METHODS.map(m => m[0]);
/** Same default as the website's Briefing on Assessment when the provider has set none. */
const DEFAULT_ASSESSMENT_BRIEFING = [
  'Place phones & other materials under the table or on the floor',
  'No photos or recording of assessment scripts',
  'No discussion during assessment',
  'Use black/blue pen for assessment [hard copies]',
  'No usage of liquid paper or correction tape',
  'Assessment scripts will be collected when the time is up',
];
const LEGACY_TYPE: Record<string, string> = { written: 'writtenAssessment', practical: 'practicalExam' };

const httpsOnly = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s]+$/i.test(s) ? s : null;
};

export async function isEnrolled(userId: string, runId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM enrollment e WHERE e.user_id=$1 AND e.course_run_id::text=$2 AND ${ACTIVE_ENROLMENT} LIMIT 1`,
    [userId, runId]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Assigned to the run (junction, legacy columns or email) or to one of its sessions. */
export async function canTrain(userId: string, runId: string): Promise<boolean> {
  if (await isAssignedTrainer(userId, runId)) return true;
  const r = await pool.query(
    `SELECT 1 FROM course_session cs WHERE cs.course_run_id::text=$2 AND cs.trainer_id=$1 AND NOT coalesce(cs.deleted,false) LIMIT 1`,
    [userId, runId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function hasAccess(userId: string, role: MobileRole, runId: string): Promise<boolean> {
  if (!UUID_RE.test(runId)) return false;
  return role === 'trainer' ? canTrain(userId, runId) : isEnrolled(userId, runId);
}

// ---------------------------------------------------------------- profile

export const THEMES = ['system', 'light', 'dark'];
const EMPLOYMENT = ['Employed', 'Unemployed', 'Looking for Job'];

export async function getProfile(userId: string) {
  await ensureMobileSchema();
  const r = await pool.query(
    `SELECT u.id, u.email, u.full_name AS "fullName", u.profile_picture_url AS "pictureURL",
            coalesce(u.theme_preference,'system') AS theme,
            coalesce(nullif(lp.tel,''), nullif(tp.tel,'')) AS phone,
            lp.company, lp.employment_status::text AS "employmentStatus",
            tp.linkedin_url AS "linkedinURL"
       FROM app_user u
       LEFT JOIN learner_profile lp ON lp.user_id=u.id
       LEFT JOIN trainer_profile tp ON tp.user_id=u.id
      WHERE u.id=$1`,
    [userId]
  );
  const brand = await pool.query(`SELECT color_scheme, company_name FROM training_provider ORDER BY created_at ASC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
  let brandColor = '#3B82F6';
  const raw = String(brand.rows[0]?.color_scheme || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) brandColor = raw;
  else if (raw.startsWith('{')) { try { const p = JSON.parse(raw).primary; if (/^#[0-9a-f]{6}$/i.test(p)) brandColor = p; } catch { /* keep default */ } }
  return { ...r.rows[0], brandColor, academy: brand.rows[0]?.company_name || null };
}

export interface ProfilePatch { fullName?: unknown; phone?: unknown; company?: unknown; employmentStatus?: unknown; linkedinURL?: unknown; theme?: unknown }

/** Allow-listed self-service edit. Never touches email, password, NRIC, roles or trainer status. */
export async function updateProfile(userId: string, roles: Set<string>, patch: ProfilePatch): Promise<string | null> {
  await ensureMobileSchema();
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
  const fullName = text(patch.fullName, 200);
  const phone = text(patch.phone, 30);
  const company = text(patch.company, 200);
  const linkedin = text(patch.linkedinURL, 300);
  if (patch.fullName !== undefined && (!fullName || fullName.length < 2)) return 'Please enter your full name.';
  if (phone !== undefined && phone !== '' && !/^[+0-9 ()-]{8,30}$/.test(phone)) return 'Please enter a valid phone number.';
  if (patch.theme !== undefined && !THEMES.includes(String(patch.theme))) return 'Unknown theme.';
  if (patch.employmentStatus !== undefined && patch.employmentStatus !== '' && !EMPLOYMENT.includes(String(patch.employmentStatus))) return 'Unknown employment status.';
  if (linkedin !== undefined && linkedin !== '' && !httpsOnly(linkedin)) return 'LinkedIn link must start with https://';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (fullName !== undefined || patch.theme !== undefined) {
      await client.query(
        `UPDATE app_user SET full_name=coalesce($2,full_name), theme_preference=coalesce($3,theme_preference), updated_at=now() WHERE id=$1`,
        [userId, fullName ?? null, patch.theme !== undefined ? String(patch.theme) : null]
      );
    }
    if (roles.has('learner') && (phone !== undefined || company !== undefined || patch.employmentStatus !== undefined)) {
      await client.query(`INSERT INTO learner_profile(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      await client.query(
        `UPDATE learner_profile SET tel=coalesce($2,tel), company=coalesce($3,company),
                employment_status=CASE WHEN $4::text IS NULL THEN employment_status ELSE $4::employment_status END
          WHERE user_id=$1`,
        [userId, phone ?? null, company ?? null, patch.employmentStatus ? String(patch.employmentStatus) : null]
      );
    }
    if (roles.has('trainer') && (phone !== undefined || linkedin !== undefined)) {
      // A trainer profile is created by the academy; the app only edits an existing one.
      await client.query(
        `UPDATE trainer_profile SET tel=coalesce(nullif($2,''),tel), linkedin_url=coalesce($3,linkedin_url) WHERE user_id=$1`,
        [userId, phone ?? null, linkedin ?? null]
      );
    }
    await client.query('COMMIT');
    return null;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- class detail

function methodsFor(courseMethods: any, runMethods: any, published: any, legacy: { written: boolean; practical: boolean }) {
  const source = runMethods && typeof runMethods === 'object' && Object.keys(runMethods).length ? runMethods : (courseMethods || {});
  return METHODS.filter(([key]) => source?.[key]?.enabled).map(([key, label]) => ({
    type: key,
    label,
    questionURL: httpsOnly(source[key]?.link),
    published: published?.[key] === true || (key === 'writtenAssessment' && legacy.written) || (key === 'practicalExam' && legacy.practical),
  }));
}

export async function classDetail(userId: string, role: MobileRole, runId: string) {
  const trainer = role === 'trainer';
  const run = (await pool.query(
    `SELECT cr.id::text, cr.course_run_id AS "runCode", c.title, coalesce(nullif(c.new_course_code,''),c.course_code) AS code,
            cr.start_date::text AS "startDate", cr.end_date::text AS "endDate", cr.class_type AS format,
            cr.class_status::text AS "classStatus", cr.virtual_meeting_link AS "meetingURL", cr.digital_attendance_id AS da,
            concat_ws(', ', nullif(cr.venue_building,''),nullif(cr.venue_street,''),nullif(cr.venue_room,'')) AS venue,
            c.slides_url, c.learner_guide_url, c.activities_url, c.lesson_plan_url, c.trainer_slides_url,
            c.facilitator_guide_url, c.assessment_plan_url,
            c.courseware_link, c.lab_simulator_url, c.practice_exam_url, c.skillsfuture_link,
            c.course_type, c.tsc_title, c.tsc_code, c.casl_skills, c.training_hours, c.assessment_hours,
            c.funding_validity::text AS funding_end,
            (SELECT h.valid_from::text FROM course_code_history h WHERE h.course_id = c.id AND h.is_current LIMIT 1) AS funding_start,
            COALESCE(
              (SELECT string_agg(crt.trainer_name, ', ' ORDER BY crt.assigned_at, crt.trainer_name)
                 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id AND crt.trainer_name <> ''),
              NULLIF(cr.assigned_trainer_name, ''),
              (SELECT au_t.full_name FROM app_user au_t WHERE au_t.id = cr.assigned_trainer_id)
            ) AS trainer_names,
            c.assessment_methods AS course_methods, cr.assessment_methods AS run_methods,
            cr.published_assessment_methods AS published,
            coalesce(cr.written_assessment_published,false) AS written, coalesce(cr.practical_assessment_published,false) AS practical
       FROM course_run cr JOIN course c ON c.id=cr.course_id
      WHERE cr.id::text=$1 AND NOT coalesce(cr.is_deleted,false)`,
    [runId]
  )).rows[0];
  if (!run) return null;

  const tp = (await pool.query(
    `SELECT coalesce(show_lesson_plan_learner_view,false) AS lesson, coalesce(feedback_form_enabled,false) AS feedback,
            feedback_form_external_link AS external, coalesce(show_certificate_delivery,false) AS delivery,
            briefing_on_assessment AS briefing FROM training_provider ORDER BY created_at ASC LIMIT 1`
  ).catch(() => ({ rows: [] as any[] }))).rows[0] || {};

  // Same items, names and order as the class page's Courseware section on the website.
  const material = (id: string, title: string, url: unknown) => ({ id, title, url: httpsOnly(url) });
  const materials = (trainer
    ? [
      material('courseware-link', 'Courseware Link', run.courseware_link),
      material('lesson-plan', 'Lesson Plan', run.lesson_plan_url),
      material('guide', 'Learner Guide', run.learner_guide_url),
      material('facilitator-guide', 'Facilitator Guide', run.facilitator_guide_url),
      material('trainer-slides', 'Trainer Slides', run.trainer_slides_url),
      material('activities', 'Activities/Lab', run.activities_url),
      material('lab-simulator', 'Lab Simulator', run.lab_simulator_url),
      material('practice-exam', 'Practice Exam', run.practice_exam_url),
      material('assessment-plan', 'Assessment Plan', run.assessment_plan_url),
      material('skillsfuture', 'SkillsFuture Link', run.skillsfuture_link),
    ]
    : [
      ...(tp.lesson ? [material('lesson-plan', 'Lesson Plan', run.lesson_plan_url)] : []),
      material('guide', 'Learner Guide', run.learner_guide_url),
      material('slides', 'Learner Slides', run.slides_url),
      material('activities', 'Activities/Lab', run.activities_url),
      material('lab-simulator', 'Lab Simulator', run.lab_simulator_url),
      material('practice-exam', 'Practice Exam', run.practice_exam_url),
      material('skillsfuture', 'SkillsFuture Link', run.skillsfuture_link),
    ]).filter(m => m.url);

  const rawSessions = (await pool.query(
    `SELECT cs.id::text, cs.start_date, cs.start_time, cs.end_time,
            (SELECT count(*)::int FROM course_attendance ca WHERE ca.session_id=cs.id AND ca.is_present) AS present
       FROM course_session cs WHERE cs.course_run_id::text=$1 AND NOT coalesce(cs.deleted,false)`,
    [runId]
  )).rows;
  const mine = trainer ? new Map<string, boolean>() : new Map<string, boolean>((await pool.query(
    `SELECT ca.session_id::text AS id, bool_or(ca.is_present) AS present
       FROM course_attendance ca JOIN course_session cs ON cs.id=ca.session_id
      WHERE cs.course_run_id::text=$1
        AND (ca.user_id=$2 OR ca.nric IN (SELECT upper(nullif(trim(lp.nric),'')) FROM learner_profile lp WHERE lp.user_id=$2))
      GROUP BY ca.session_id`,
    [runId, userId]
  )).rows.map((r: any) => [r.id, r.present]));
  const sessions = labelSessions(rawSessions).map(s => ({
    id: s.id, label: s.label, date: s.isoDate, startTime: s.start_time || null, endTime: s.end_time || null,
    ...(trainer ? { presentCount: (s as any).present } : { attendance: mine.has(s.id) ? (mine.get(s.id) ? 'present' : 'absent') : null }),
  }));

  const methods = methodsFor(run.course_methods, run.run_methods, run.published, { written: run.written, practical: run.practical });
  const da = typeof run.da === 'string' && /^RA\w{4,}$/.test(run.da.trim()) ? run.da.trim() : null;
  const casl = run.course_type === 'CASL';
  const hours = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const announcements = (await pool.query(
    `SELECT id::text, title, message, link_url AS "linkURL", file_name AS "fileName", file_url AS "fileURL",
            posted_by AS "postedBy", created_at AS "createdAt"
       FROM course_announcement WHERE course_run_id::text=$1 ORDER BY created_at DESC LIMIT 50`,
    [runId]
  ).catch(() => ({ rows: [] as any[] }))).rows.map((a: any) => ({
    ...a, linkURL: httpsOnly(a.linkURL), fileURL: httpsOnly(a.fileURL),
  }));
  const briefing = String(tp.briefing || '').split('\n').map(l => l.trim()).filter(Boolean);
  const base: any = {
    id: run.id, runCode: run.runCode, title: run.title, code: run.code, startDate: run.startDate, endDate: run.endDate,
    format: run.format, classStatus: run.classStatus, meetingURL: httpsOnly(run.meetingURL), venue: run.venue || null,
    materials, sessions, traqomURL: TRAQOM_URL,
    // The class page's Course Details and Class Details panels.
    courseDetails: {
      tscTitle: casl ? 'NA' : run.tsc_title || null,
      tscCode: casl ? 'NA' : run.tsc_code || null,
      caslSkills: casl ? run.casl_skills || null : null,
      fundingValidityStart: run.funding_start ? String(run.funding_start).slice(0, 10) : null,
      fundingValidityEnd: run.funding_end ? String(run.funding_end).slice(0, 10) : null,
      trainingHours: hours(run.training_hours),
      assessmentHours: hours(run.assessment_hours),
    },
    trainerNames: String(run.trainer_names || '').split(',').map(t => t.trim()).filter(Boolean),
    digitalAttendanceId: typeof run.da === 'string' && run.da.trim() ? run.da.trim() : null,
    announcements,
    briefingOnAssessment: briefing.length ? briefing : DEFAULT_ASSESSMENT_BRIEFING,
    showCourseFeedback: !!tp.delivery,
  };

  if (!trainer) {
    const subs = (await pool.query(
      `SELECT id::text, assessment_type AS type, file_name AS "fileName", file_url AS "fileURL", submitted_at AS "submittedAt",
              assessor_signed_at IS NOT NULL AS signed
         FROM link_assessment_submission WHERE user_id=$1 AND course_run_id::text=$2 ORDER BY submitted_at DESC`,
      [userId, runId]
    ).catch(() => ({ rows: [] as any[] }))).rows;
    const enrol = (await pool.query(
      `SELECT e.assessment_status AS status, coalesce(e.traqom_completed,false) AS traqom FROM enrollment e
        WHERE e.user_id=$1 AND e.course_run_id::text=$2 AND ${ACTIVE_ENROLMENT} LIMIT 1`, [userId, runId])).rows[0];
    const submitted = (await pool.query(
      `SELECT 1 FROM feedback_form_response WHERE user_id=$1 AND course_run_id::text=$2 LIMIT 1`, [userId, runId]
    ).catch(() => ({ rowCount: 0 }))).rowCount! > 0;
    return {
      ...base,
      ssgAttendanceURL: da ? `https://www.myskillsfuture.gov.sg/api/take-attendance/${da}` : null,
      // Unpublished question papers are never sent to a learner.
      assessments: methods.filter(m => m.published).map(m => ({
        ...m, submissions: subs.filter((s: any) => (LEGACY_TYPE[s.type] || s.type) === m.type),
      })),
      assessmentStatus: enrol?.status || null,
      traqomCompleted: !!enrol?.traqom,
      feedback: { enabled: !!tp.feedback || !httpsOnly(tp.external), externalURL: httpsOnly(tp.external), submitted },
    };
  }

  const roster = (await pool.query(
    `SELECT e.id::text AS "enrolmentId", coalesce(u.full_name,'Learner') AS name, e.assessment_status AS status,
            coalesce(e.traqom_completed,false) AS "traqomCompleted",
            (SELECT count(*)::int FROM link_assessment_submission s WHERE s.user_id=e.user_id AND s.course_run_id=e.course_run_id) AS submissions
       FROM enrollment e LEFT JOIN app_user u ON u.id=e.user_id
      WHERE e.course_run_id::text=$1 AND ${ACTIVE_ENROLMENT} AND e.user_id IS DISTINCT FROM $2
      ORDER BY 2`,
    [runId, userId]
  )).rows;
  const feedbackCount = (await pool.query(
    `SELECT count(*)::int AS n FROM feedback_form_response WHERE course_run_id::text=$1`, [runId]
  ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  return {
    ...base,
    // Course Feedback card: the provider's external form, else the built-in one for this class.
    courseFeedbackURL: httpsOnly(tp.external) || `/feedback/${encodeURIComponent(run.id)}`,
    // SWDA Enrolment: the class's public enrolment form, for learners not yet enrolled.
    swdaEnrolmentURL: `/enrol/${encodeURIComponent(run.id)}`,
    ssgAttendanceURL: da ? `https://www.myskillsfuture.gov.sg/spface/splogin/select-session?course-run-code=${da}` : null,
    assessments: methods.map(m => ({ ...m, submissions: [] })),
    roster, feedbackCount,
  };
}

// ---------------------------------------------------------------- trainer attendance

/** The run a session belongs to, or null when the session is unknown/removed. */
export async function sessionRun(sessionId: string): Promise<string | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const r = await pool.query(
    `SELECT cs.course_run_id::text AS run FROM course_session cs JOIN course_run cr ON cr.id=cs.course_run_id
      WHERE cs.id::text=$1 AND NOT coalesce(cs.deleted,false) AND NOT coalesce(cr.is_deleted,false)`, [sessionId]);
  return r.rows[0]?.run || null;
}

interface RosterKey { enrolmentId: string; name: string; userId: string | null; key: string | null }

async function attendanceRoster(runId: string, excludeUser: string): Promise<RosterKey[]> {
  const r = await pool.query(
    `SELECT e.id::text AS "enrolmentId", coalesce(u.full_name,'Learner') AS name, e.user_id::text AS "userId",
            upper(coalesce(nullif(trim(e.nric),''), nullif(trim(lp.nric),''))) AS nric
       FROM enrollment e LEFT JOIN app_user u ON u.id=e.user_id LEFT JOIN learner_profile lp ON lp.user_id=e.user_id
      WHERE e.course_run_id::text=$1 AND ${ACTIVE_ENROLMENT} AND e.user_id IS DISTINCT FROM $2
      ORDER BY 2`,
    [runId, excludeUser]
  );
  return r.rows.map((x: any) => ({ enrolmentId: x.enrolmentId, name: x.name, userId: x.userId, key: x.nric || (x.userId ? `_uid_${x.userId}` : null) }));
}

/** Per-learner attendance for one session. NRICs stay on the server: the app sees enrolment ids. */
export async function sessionAttendance(runId: string, sessionId: string, trainerId: string) {
  const roster = await attendanceRoster(runId, trainerId);
  const rows = (await pool.query(
    `SELECT upper(nric) AS nric, user_id::text AS "userId", is_present AS present, reason_of_absence AS reason
       FROM course_attendance WHERE session_id::text=$1`, [sessionId])).rows;
  return roster.map(p => {
    const hit = rows.find((r: any) => (p.key && r.nric === p.key.toUpperCase()) || (p.userId && r.userId === p.userId));
    return { enrolmentId: p.enrolmentId, name: p.name, isPresent: hit ? !!hit.present : null, reason: hit?.reason || '' };
  });
}

export async function markAttendance(
  runId: string, sessionId: string, trainerId: string,
  records: { enrolmentId?: unknown; isPresent?: unknown; reason?: unknown }[]
): Promise<number> {
  const roster = await attendanceRoster(runId, trainerId);
  const client = await pool.connect();
  let saved = 0;
  try {
    await client.query('BEGIN');
    for (const rec of records) {
      const person = roster.find(p => p.enrolmentId === rec.enrolmentId);
      if (!person?.key || typeof rec.isPresent !== 'boolean') continue; // not on this class: ignored
      const reason = rec.isPresent ? null : (typeof rec.reason === 'string' ? rec.reason.trim().slice(0, 300) || null : null);
      await client.query(
        `INSERT INTO course_attendance (session_id, nric, user_id, is_present, reason_of_absence, updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (session_id, nric) DO UPDATE SET is_present=EXCLUDED.is_present,
           reason_of_absence=EXCLUDED.reason_of_absence,
           user_id=coalesce(EXCLUDED.user_id, course_attendance.user_id), updated_at=now()`,
        [sessionId, person.key, person.userId, rec.isPresent, reason]
      );
      saved++;
    }
    await client.query('COMMIT');
    return saved;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { toIsoDate };
