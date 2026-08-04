import pool from './db';
import { appendMemory } from './nemo-memory';

// Base URL for internal API calls
const BASE_URL = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';

async function callApi(method: string, path: string, body?: any, query?: Record<string, string>): Promise<string> {
  const url = new URL(path, BASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Internal server-to-self call: authenticate as the service principal
      ...(process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT
        ? { 'x-api-key': process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return JSON.stringify(data);
}

async function queryDb(sql: string, params: any[] = []): Promise<string> {
  const result = await pool.query(sql, params);
  return JSON.stringify({ count: result.rows.length, data: result.rows });
}

// ─── Tool Definitions (Anthropic format) ────────────────────────────────────

export const NEMO_TOOLS = [
  // ── Read Tools ──
  {
    name: 'get_dashboard_summary',
    description: 'Get high-level KPI summary: ongoing classes, upcoming classes, completed classes, trainer assignment status.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'search_course_runs',
    description: 'Search and filter course runs. Can filter by status, trainer assignment, date range, and search terms.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by course title, code, or run ID' },
        status: { type: 'string', description: 'Filter by class_status (e.g. Confirmed, Cancelled)' },
        has_trainer: { type: 'boolean', description: 'Filter: true=has trainer, false=missing trainer' },
        upcoming: { type: 'string', description: 'Set to "true" to show only upcoming classes' },
        ongoing: { type: 'string', description: 'Set to "true" to show only ongoing classes' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'get_course_run_details',
    description: 'Get full details of a specific course run including trainers, sessions, enrollment count, and funding validity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_run_id: { type: 'string', description: 'The course run UUID or string ID (e.g. CRS-RUN-001)' },
      },
      required: ['course_run_id'],
    },
  },
  {
    name: 'list_trainers',
    description: 'List all trainers with their profiles, status (Active/Inactive), expertise, and qualifications.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by trainer name or email' },
        status: { type: 'string', description: 'Filter by Active or Inactive' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'search_enrolments',
    description: 'Search enrollments across course runs. Can filter by status and payment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_run_id: { type: 'string', description: 'Filter by course run UUID' },
        search: { type: 'string', description: 'Search by learner name, NRIC, or email' },
        payment_status: { type: 'string', description: 'Filter by Paid or Unpaid' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'search_claims',
    description: 'Search SSG grant claims by status, claim ID, or trainee name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by trainee name, claim ID, or grant ID' },
        claim_status: { type: 'string', description: 'Filter by claim status' },
        outstanding_only: { type: 'boolean', description: 'Show only outstanding/pending claims' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'search_grants',
    description: 'Search SSG grants by status, funding scheme, or grant ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by grant ID, enrollment ID, or scheme' },
        status: { type: 'string', description: 'Filter by grant status (e.g. Pending, Approved)' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'check_course_validity',
    description: 'Check if a course has valid funding by its course code (e.g. TGS-2023036653).',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_code: { type: 'string', description: 'The course reference code (e.g. TGS-XXXXX)' },
      },
      required: ['course_code'],
    },
  },
  {
    name: 'get_sessions',
    description: 'Get all sessions for a specific course run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_run_id: { type: 'string', description: 'Course run UUID' },
      },
      required: ['course_run_id'],
    },
  },
  {
    name: 'get_attendance',
    description: 'Get attendance records for a specific session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'Session UUID' },
      },
      required: ['session_id'],
    },
  },

  // ── Write/Action Tools ──
  {
    name: 'send_trainer_invitation',
    description: 'Send an email invitation to a trainer for a course run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_run_uuid: { type: 'string', description: 'Course run UUID' },
        trainer_name: { type: 'string', description: 'Optional: specific trainer name to invite' },
      },
      required: ['course_run_uuid'],
    },
  },
  {
    name: 'add_course_run',
    description: 'Create a new course run in the system.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_code: { type: 'string', description: 'Course reference code' },
        course_run_id: { type: 'string', description: 'Course run identifier' },
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        class_status: { type: 'string', description: 'Status (default: Confirmed)' },
      },
      required: ['course_code', 'course_run_id'],
    },
  },
  {
    name: 'enroll_learner',
    description: 'Enroll a learner into a course by their email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        course_id: { type: 'string', description: 'Course UUID' },
        learner_email: { type: 'string', description: 'Learner email address' },
      },
      required: ['course_id', 'learner_email'],
    },
  },
  {
    name: 'generate_proforma_invoice',
    description: 'Generate a proforma invoice PDF for a learner.',
    input_schema: {
      type: 'object' as const,
      properties: {
        full_name: { type: 'string', description: 'Learner full name' },
        course_title: { type: 'string', description: 'Course title' },
        course_code: { type: 'string', description: 'Course reference code' },
        course_fees_exclude_gst: { type: 'string', description: 'Course fee excluding GST' },
        start_date: { type: 'string', description: 'Course start date' },
        sponsorship_type: { type: 'string', description: 'Self-Sponsored, Employer-Sponsored, or Organisation-Sponsored' },
      },
      required: ['full_name', 'course_title'],
    },
  },
  {
    name: 'quickbooks_operation',
    description: 'Perform QuickBooks operations: query, create, send, delete, void, or read invoices/estimates/payments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', description: 'Action: query, create, send, delete, void, pdf, read' },
        entity: { type: 'string', description: 'Entity: estimate, invoice, payment' },
        id: { type: 'string', description: 'Entity ID (for send/delete/void/pdf/read)' },
        query: { type: 'string', description: 'SQL-like query string (for query action)' },
        body: { type: 'object', description: 'Request body (for create action)' },
      },
      required: ['action', 'entity'],
    },
  },
  {
    name: 'ssg_course_operation',
    description: 'Perform SSG (SkillsFuture) course run operations: list, create, update, or delete course runs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE' },
        run_id: { type: 'string', description: 'Course run ID (for GET/PUT/DELETE)' },
        course_data: { type: 'object', description: 'Course data object (for POST/PUT)' },
      },
      required: ['method'],
    },
  },
  {
    name: 'update_memory',
    description: 'Save an important observation, user preference, or action result to persistent memory for future sessions. Use sparingly — only for genuinely useful context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        section: { type: 'string', description: 'Memory section: User Preferences, Operational Context, Recent Actions Log, or Known Issues' },
        entry: { type: 'string', description: 'The text entry to save' },
      },
      required: ['section', 'entry'],
    },
  },
];

// ── Write tool names (for role-based filtering) ──
const WRITE_TOOLS = new Set([
  'send_trainer_invitation', 'add_course_run',
  'enroll_learner', 'generate_proforma_invoice', 'quickbooks_operation',
  'ssg_course_operation', 'update_memory',
]);

export function getToolsForRole(role: string): typeof NEMO_TOOLS {
  const upperRole = role?.toUpperCase().replace(/\s+/g, '_') || '';
  const canWrite = ['ADMIN', 'TRAINING_PROVIDER', 'TRAININGPROVIDER', 'FINANCE'].includes(upperRole);
  if (canWrite) return NEMO_TOOLS;
  return NEMO_TOOLS.filter(t => !WRITE_TOOLS.has(t.name));
}

// ─── Tool Executors ─────────────────────────────────────────────────────────

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case 'get_dashboard_summary':
        return await callApi('GET', '/api/admin/statistics');

      case 'search_course_runs':
        return await callApi('GET', '/api/admin/all-course-runs', undefined, {
          search: input.search || '',
          status: input.status || '',
          upcoming: input.upcoming || '',
          ongoing: input.ongoing || '',
        });

      case 'get_course_run_details': {
        const id = input.course_run_id;
        const result = await queryDb(
          `SELECT cr.*, c.title AS course_title, c.course_code
           FROM course_run cr LEFT JOIN course c ON cr.course_id = c.id
           WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`, [id]
        );
        const parsed = JSON.parse(result);
        if (parsed.count === 0) return JSON.stringify({ error: `Course run '${id}' not found` });
        const run = parsed.data[0];
        const trainers = await queryDb(
          `SELECT trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1`, [run.id]
        );
        const enrollments = await queryDb(
          `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE payment_status = 'Paid') as paid
           FROM enrollment WHERE course_run_id = $1`, [run.id]
        );
        return JSON.stringify({ ...run, trainers: JSON.parse(trainers).data, enrollment_summary: JSON.parse(enrollments).data[0] });
      }

      case 'list_trainers':
        return await queryDb(
          `SELECT tp.user_id, au.name, au.email, tp.status, tp.trainer_type, tp.expertise
           FROM trainer_profile tp JOIN app_user au ON tp.user_id = au.id
           WHERE ($1 = '' OR tp.status = $1) AND ($2 = '' OR au.name ILIKE '%' || $2 || '%' OR au.email ILIKE '%' || $2 || '%')
           ORDER BY au.name LIMIT 50`,
          [input.status || '', input.search || '']
        );

      case 'search_enrolments':
        return await queryDb(
          `SELECT e.id, e.enrolment_id, au.name AS learner_name, au.email, e.payment_status, e.enrolment_status,
                  cr.course_run_id, c.title AS course_title
           FROM enrollment e
           LEFT JOIN app_user au ON e.user_id = au.id
           LEFT JOIN course_run cr ON e.course_run_id = cr.id
           LEFT JOIN course c ON cr.course_id = c.id
           WHERE ($1 = '' OR cr.id::text = $1)
             AND ($2 = '' OR e.payment_status = $2)
             AND ($3 = '' OR au.name ILIKE '%' || $3 || '%' OR au.email ILIKE '%' || $3 || '%')
           ORDER BY e.created_at DESC LIMIT 30`,
          [input.course_run_id || '', input.payment_status || '', input.search || '']
        );

      case 'search_claims':
        return await queryDb(
          `SELECT * FROM ssg_claims
           WHERE ($1 = '' OR claim_status = $1)
             AND ($2::boolean = false OR claim_status NOT IN ('Approved','Paid','Completed'))
             AND ($3 = '' OR trainee_name ILIKE '%' || $3 || '%' OR claim_id ILIKE '%' || $3 || '%')
           ORDER BY created_at DESC LIMIT 30`,
          [input.claim_status || '', input.outstanding_only || false, input.search || '']
        );

      case 'search_grants':
        return await queryDb(
          `SELECT * FROM ssg_grants
           WHERE ($1 = '' OR status = $1)
             AND ($2 = '' OR grant_id ILIKE '%' || $2 || '%' OR enrollment_id ILIKE '%' || $2 || '%')
           ORDER BY created_at DESC LIMIT 30`,
          [input.status || '', input.search || '']
        );

      case 'check_course_validity':
        return await queryDb(
          `SELECT course_code, title, funding_validity,
                  CASE WHEN funding_validity IS NULL THEN 'unknown'
                       WHEN funding_validity >= CURRENT_DATE THEN 'valid'
                       ELSE 'expired' END AS validity_status
           FROM course WHERE course_code = $1 LIMIT 1`,
          [input.course_code]
        );

      case 'get_sessions':
        return await queryDb(
          `SELECT * FROM course_session WHERE course_run_id = $1 AND (is_deleted IS NULL OR is_deleted = false) ORDER BY session_date`,
          [input.course_run_id]
        );

      case 'get_attendance':
        return await queryDb(
          `SELECT ca.*, au.name AS learner_name FROM course_attendance ca
           LEFT JOIN app_user au ON ca.user_id = au.id
           WHERE ca.session_id = $1`,
          [input.session_id]
        );

      // ── Write tools ──
      case 'send_trainer_invitation':
        return await callApi('POST', '/api/admin/send-trainer-invitation', {
          courseRunUuid: input.course_run_uuid,
          overrideTrainerName: input.trainer_name,
        });

      case 'add_course_run':
        return await callApi('POST', '/api/admin/add-course-run', {
          courseCode: input.course_code,
          courseRunId: input.course_run_id,
          startDate: input.start_date,
          endDate: input.end_date,
          classStatus: input.class_status || 'Confirmed',
        });

      case 'enroll_learner':
        return await callApi('POST', '/api/enrolments/enroll', {
          courseId: input.course_id,
          learnerEmail: input.learner_email,
        });

      case 'generate_proforma_invoice':
        return await callApi('POST', '/api/billing/proforma', {
          full_name: input.full_name,
          course_title: input.course_title,
          course_code: input.course_code,
          course_fees_exclude_gst: input.course_fees_exclude_gst,
          start_date: input.start_date,
          sponsorship_type: input.sponsorship_type,
        });

      case 'quickbooks_operation':
        return await callApi('POST', '/api/quickbooks/proxy', {
          action: input.action,
          entity: input.entity,
          id: input.id,
          query: input.query,
          body: input.body,
        });

      case 'ssg_course_operation':
        if (input.method === 'GET') {
          return await callApi('GET', '/api/ssg/courses', undefined, { runId: input.run_id || '' });
        }
        return await callApi(input.method, '/api/ssg/courses', input.course_data);

      case 'update_memory':
        appendMemory(input.section, input.entry);
        return JSON.stringify({ success: true, message: `Memory updated in "${input.section}"` });

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || `Tool ${name} failed` });
  }
}
