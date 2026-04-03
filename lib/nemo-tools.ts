import pool from './db';

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function-calling format)
// ---------------------------------------------------------------------------

export const NEMO_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_course_runs',
      description: 'Search and filter course runs (classes). Returns list of course runs with trainer assignments, enrollment counts, and status.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['Confirmed', 'Pending', 'Cancelled', 'Reschedule'], description: 'Filter by class status' },
          has_trainer: { type: 'boolean', description: 'Filter by whether a trainer is assigned (true = has trainer, false = no trainer)' },
          search: { type: 'string', description: 'Search by course title, course code, run ID, or trainer name' },
          start_date_from: { type: 'string', description: 'Filter runs starting on or after this date (YYYY-MM-DD)' },
          start_date_to: { type: 'string', description: 'Filter runs starting on or before this date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Max results to return (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_course_run_details',
      description: 'Get full details of a specific course run including sessions, enrollments, trainers, and attendance status.',
      parameters: {
        type: 'object',
        properties: {
          course_run_id: { type: 'string', description: 'The course_run_id string (e.g. "CRS-RUN-001") or UUID' },
        },
        required: ['course_run_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_trainers',
      description: 'List trainers with their profiles, status, and type. Can filter by active status.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['Active', 'Inactive'], description: 'Filter by trainer status' },
          search: { type: 'string', description: 'Search by trainer name or email' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'assign_trainer',
      description: 'Assign a trainer to a course run. Requires the course run UUID and trainer user UUID.',
      parameters: {
        type: 'object',
        properties: {
          course_run_uuid: { type: 'string', description: 'UUID of the course run' },
          trainer_user_id: { type: 'string', description: 'UUID of the trainer (app_user.id)' },
        },
        required: ['course_run_uuid', 'trainer_user_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_enrolments',
      description: 'Search enrolments across course runs. Can filter by status, payment, NRIC, or course.',
      parameters: {
        type: 'object',
        properties: {
          course_run_uuid: { type: 'string', description: 'Filter by course run UUID' },
          enrolment_status: { type: 'string', description: 'Filter by enrolment status' },
          payment_status: { type: 'string', enum: ['Paid', 'Unpaid'], description: 'Filter by payment status' },
          search: { type: 'string', description: 'Search by trainee name, NRIC, email, or enrolment ID' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_claims',
      description: 'Search SSG grant claims. Can filter by status, course reference, or trainee.',
      parameters: {
        type: 'object',
        properties: {
          claim_status: { type: 'string', description: 'Filter by claim status (e.g. Pending, Approved, Rejected)' },
          search: { type: 'string', description: 'Search by trainee name, claim ID, grant ID, or course reference' },
          outstanding_only: { type: 'boolean', description: 'If true, show only claims that are not yet approved/paid' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_grants',
      description: 'Search SSG grants. Can filter by status or enrollment.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by grant status (e.g. Pending, Approved, Rejected)' },
          search: { type: 'string', description: 'Search by grant ID, enrollment ID, or funding scheme' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_course_validity',
      description: 'Check if a course has valid funding by verifying its funding validity date.',
      parameters: {
        type: 'object',
        properties: {
          course_code: { type: 'string', description: 'Course code (e.g. TGS-2023036653)' },
          search: { type: 'string', description: 'Search by course title or code' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_sessions',
      description: 'Get sessions for a course run with attendance status.',
      parameters: {
        type: 'object',
        properties: {
          course_run_uuid: { type: 'string', description: 'UUID of the course run' },
        },
        required: ['course_run_uuid'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_attendance',
      description: 'Get attendance records for a specific session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'UUID of the course session' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_dashboard_summary',
      description: 'Get a high-level summary: total courses, active course runs, upcoming classes, pending enrolments, outstanding claims, trainers without assignments.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    const result = await executeToolInner(name, args);
    return JSON.stringify(result);
  } catch (error: any) {
    return JSON.stringify({ error: error.message || 'Tool execution failed' });
  }
}

async function executeToolInner(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'search_course_runs': return searchCourseRuns(args);
    case 'get_course_run_details': return getCourseRunDetails(args);
    case 'list_trainers': return listTrainers(args);
    case 'assign_trainer': return assignTrainer(args);
    case 'search_enrolments': return searchEnrolments(args);
    case 'search_claims': return searchClaims(args);
    case 'search_grants': return searchGrants(args);
    case 'check_course_validity': return checkCourseValidity(args);
    case 'get_sessions': return getSessions(args);
    case 'get_attendance': return getAttendance(args);
    case 'get_dashboard_summary': return getDashboardSummary();
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

async function searchCourseRuns(args: Record<string, any>) {
  const limit = Math.min(args.limit || 20, 50);
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.status) {
    params.push(args.status);
    conditions.push(`cr.class_status = $${params.length}`);
  }

  if (args.has_trainer === true) {
    conditions.push(`(cr.assigned_trainer_id IS NOT NULL OR EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id))`);
  } else if (args.has_trainer === false) {
    conditions.push(`cr.assigned_trainer_id IS NULL AND NOT EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(c.title ILIKE $${params.length} OR c.course_code ILIKE $${params.length} OR cr.course_run_id ILIKE $${params.length} OR cr.assigned_trainer_name ILIKE $${params.length})`);
  }

  if (args.start_date_from) {
    params.push(args.start_date_from);
    conditions.push(`cr.start_date >= $${params.length}`);
  }

  if (args.start_date_to) {
    params.push(args.start_date_to);
    conditions.push(`cr.start_date <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT cr.id, cr.course_run_id, c.title AS course_title, c.course_code,
           cr.class_status, cr.start_date, cr.end_date, cr.mode_of_learning,
           cr.assigned_trainer_name, cr.assigned_trainer_email,
           COALESCE(trs.trainer_names, cr.assigned_trainer_name) AS all_trainers,
           (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS enrollment_count
    FROM course_run cr
    JOIN course c ON cr.course_id = c.id
    LEFT JOIN (
      SELECT course_run_id, STRING_AGG(trainer_name, ', ' ORDER BY assigned_at) AS trainer_names
      FROM course_run_trainer GROUP BY course_run_id
    ) trs ON trs.course_run_id = cr.id
    ${where}
    ORDER BY cr.start_date DESC NULLS LAST
    LIMIT ${limit}
  `, params);

  return { count: rows.length, course_runs: rows };
}

async function getCourseRunDetails(args: Record<string, any>) {
  const { course_run_id } = args;

  // Try UUID first, then string run ID
  const { rows } = await pool.query(`
    SELECT cr.*, c.title AS course_title, c.course_code, c.funding_validity
    FROM course_run cr
    JOIN course c ON cr.course_id = c.id
    WHERE cr.id::text = $1 OR cr.course_run_id = $1
    LIMIT 1
  `, [course_run_id]);

  if (rows.length === 0) return { error: 'Course run not found' };

  const run = rows[0];

  // Get trainers
  const trainers = await pool.query(
    `SELECT id, trainer_id, trainer_name, trainer_email, assigned_at FROM course_run_trainer WHERE course_run_id = $1`,
    [run.id]
  );

  // Get sessions
  const sessions = await pool.query(
    `SELECT id, session_number, title, start_date, end_date, start_time, end_time, mode_of_training, attendance_taken
     FROM course_session WHERE course_run_id = $1 AND (deleted IS NULL OR deleted = false) ORDER BY start_date, start_time`,
    [run.id]
  );

  // Get enrollment count
  const enrolCount = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE payment_status = 'Paid') AS paid FROM enrollment WHERE course_run_id = $1`,
    [run.id]
  );

  return {
    ...run,
    trainers: trainers.rows,
    sessions: sessions.rows,
    enrollment_summary: enrolCount.rows[0],
  };
}

async function listTrainers(args: Record<string, any>) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.status) {
    params.push(args.status);
    conditions.push(`tp.status = $${params.length}`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, tp.status, tp.trainer_type, tp.gender,
           tp.areas_of_expertise, tp.qualifications, tp.tel
    FROM trainer_profile tp
    JOIN app_user u ON tp.user_id = u.id
    WHERE 1=1 ${where}
    ORDER BY u.name
    LIMIT 50
  `, params);

  return { count: rows.length, trainers: rows };
}

async function assignTrainer(args: Record<string, any>) {
  const { course_run_uuid, trainer_user_id } = args;

  // Get trainer info
  const trainer = await pool.query(
    `SELECT u.id, u.name, u.email FROM app_user u WHERE u.id = $1`,
    [trainer_user_id]
  );

  if (trainer.rows.length === 0) return { error: 'Trainer not found' };

  const { name, email } = trainer.rows[0];

  // Insert into junction table
  await pool.query(`
    INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
  `, [course_run_uuid, trainer_user_id, name, email]);

  // Also update the main course_run assigned trainer fields
  await pool.query(`
    UPDATE course_run
    SET assigned_trainer_id = $2, assigned_trainer_name = $3, assigned_trainer_email = $4, updated_at = NOW()
    WHERE id = $1
  `, [course_run_uuid, trainer_user_id, name, email]);

  return { success: true, message: `Trainer ${name} (${email}) assigned to course run.` };
}

async function searchEnrolments(args: Record<string, any>) {
  const limit = Math.min(args.limit || 20, 50);
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.course_run_uuid) {
    params.push(args.course_run_uuid);
    conditions.push(`e.course_run_id = $${params.length}`);
  }

  if (args.enrolment_status) {
    params.push(args.enrolment_status);
    conditions.push(`e.enrolment_status = $${params.length}`);
  }

  if (args.payment_status) {
    params.push(args.payment_status);
    conditions.push(`e.payment_status = $${params.length}`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR e.nric ILIKE $${params.length} OR u.email ILIKE $${params.length} OR e.enrolment_id ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT e.id, e.enrolment_id, e.enrolment_status, e.payment_status, e.assessment_status,
           e.enrolment_date, e.course_sponsorship, e.progress_percent,
           u.name AS learner_name, u.email AS learner_email, e.nric,
           c.title AS course_title, cr.course_run_id, cr.start_date, cr.end_date
    FROM enrollment e
    LEFT JOIN app_user u ON e.user_id = u.id
    LEFT JOIN course_run cr ON e.course_run_id = cr.id
    LEFT JOIN course c ON e.course_id = c.id
    ${where}
    ORDER BY e.enrolment_date DESC NULLS LAST
    LIMIT ${limit}
  `, params);

  return { count: rows.length, enrolments: rows };
}

async function searchClaims(args: Record<string, any>) {
  const limit = Math.min(args.limit || 20, 50);
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.claim_status) {
    params.push(args.claim_status);
    conditions.push(`claim_status = $${params.length}`);
  }

  if (args.outstanding_only) {
    conditions.push(`claim_status NOT IN ('Approved', 'Paid', 'Completed')`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(trainee_name ILIKE $${params.length} OR claim_id ILIKE $${params.length} OR grant_id ILIKE $${params.length} OR course_reference ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT claim_id, grant_id, enrollment_id, trainee_name, course_reference,
           training_partner_code, claim_status, claim_amount,
           submission_date, approval_date, payment_date
    FROM ssg_claims
    ${where}
    ORDER BY submission_date DESC NULLS LAST
    LIMIT ${limit}
  `, params);

  return { count: rows.length, claims: rows };
}

async function searchGrants(args: Record<string, any>) {
  const limit = Math.min(args.limit || 20, 50);
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.status) {
    params.push(args.status);
    conditions.push(`status = $${params.length}`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(grant_id ILIKE $${params.length} OR enrollment_id ILIKE $${params.length} OR funding_scheme_description ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT grant_id, enrollment_id, status, funding_scheme_code, funding_scheme_description,
           component_code, component_description, estimated_grant_amount, approved_grant_amount, created_date
    FROM ssg_grants
    ${where}
    ORDER BY created_date DESC NULLS LAST
    LIMIT ${limit}
  `, params);

  return { count: rows.length, grants: rows };
}

async function checkCourseValidity(args: Record<string, any>) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (args.course_code) {
    params.push(args.course_code);
    conditions.push(`course_code = $${params.length}`);
  }

  if (args.search) {
    params.push(`%${args.search}%`);
    conditions.push(`(title ILIKE $${params.length} OR course_code ILIKE $${params.length})`);
  }

  if (conditions.length === 0) {
    return { error: 'Provide course_code or search term' };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(`
    SELECT id, title, course_code, funding_validity,
           CASE
             WHEN funding_validity IS NULL THEN 'unknown'
             WHEN funding_validity >= CURRENT_DATE THEN 'valid'
             ELSE 'expired'
           END AS validity_status
    FROM course
    ${where}
    ORDER BY title
    LIMIT 20
  `, params);

  return { count: rows.length, courses: rows };
}

async function getSessions(args: Record<string, any>) {
  const { rows } = await pool.query(`
    SELECT id, session_number, title, start_date, end_date, start_time, end_time,
           mode_of_training, attendance_taken
    FROM course_session
    WHERE course_run_id = $1 AND (deleted IS NULL OR deleted = false)
    ORDER BY start_date, start_time
  `, [args.course_run_uuid]);

  return { count: rows.length, sessions: rows };
}

async function getAttendance(args: Record<string, any>) {
  const { rows } = await pool.query(`
    SELECT ca.id, ca.nric, ca.is_present, ca.reason_of_absence,
           u.name AS learner_name, u.email AS learner_email
    FROM course_attendance ca
    LEFT JOIN app_user u ON ca.user_id = u.id
    WHERE ca.session_id = $1
    ORDER BY u.name, ca.nric
  `, [args.session_id]);

  const present = rows.filter(r => r.is_present).length;
  const absent = rows.filter(r => !r.is_present).length;

  return { total: rows.length, present, absent, records: rows };
}

async function getDashboardSummary() {
  const [courses, activeRuns, upcomingNoTrainer, pendingEnrolments, outstandingClaims] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM course`),
    pool.query(`SELECT COUNT(*) AS total FROM course_run WHERE class_status = 'Confirmed'`),
    pool.query(`
      SELECT COUNT(*) AS total FROM course_run cr
      WHERE cr.class_status IN ('Confirmed', 'Pending')
        AND cr.start_date >= CURRENT_DATE
        AND cr.assigned_trainer_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
    `),
    pool.query(`SELECT COUNT(*) AS total FROM enrollment WHERE enrolment_status = 'Pending' OR payment_status = 'Unpaid'`),
    pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(claim_amount), 0) AS total_amount FROM ssg_claims WHERE claim_status NOT IN ('Approved', 'Paid', 'Completed')`),
  ]);

  return {
    total_courses: parseInt(courses.rows[0].total),
    active_course_runs: parseInt(activeRuns.rows[0].total),
    upcoming_classes_without_trainer: parseInt(upcomingNoTrainer.rows[0].total),
    pending_enrolments: parseInt(pendingEnrolments.rows[0].total),
    outstanding_claims_count: parseInt(outstandingClaims.rows[0].total),
    outstanding_claims_amount: parseFloat(outstandingClaims.rows[0].total_amount),
  };
}
