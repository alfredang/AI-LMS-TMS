import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { isStaff, requireCourseRunTrainer } from '../../../lib/auth/courseRunAccess';
import {
  ensurePracticeExamColumn, examsApiConfigured, listPracticeExams, listRegistrations, registerLearner,
  type ExamRegistration, type PracticeExamRef, type RegisterResult,
} from '../../../lib/practiceExam/examsApi';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RunContext {
  courseId: string;
  courseTitle: string;
  courseCode: string | null;
  courseRunId: string;
  examCode: string | null;
}

async function getRun(courseRunUuid: string): Promise<RunContext | null> {
  const r = await pool.query(
    `SELECT c.id AS course_id, c.title, c.course_code, c.practice_exam_code, cr.course_run_id
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1`,
    [courseRunUuid]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    courseId: row.course_id,
    courseTitle: row.title,
    courseCode: row.course_code,
    courseRunId: String(row.course_run_id || '').trim(),
    examCode: row.practice_exam_code ? String(row.practice_exam_code).trim() || null : null,
  };
}

/** The class's learners (local enrolments, excluding cancelled/withdrawn), one row per email. */
async function getLearners(courseRunUuid: string): Promise<{ name: string; email: string }[]> {
  const r = await pool.query(
    `SELECT DISTINCT ON (LOWER(TRIM(au.email))) TRIM(au.full_name) AS name, LOWER(TRIM(au.email)) AS email
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('cancelled', 'withdrawn', 'rejected')
        AND au.email IS NOT NULL AND TRIM(au.email) <> ''
      ORDER BY LOWER(TRIM(au.email)), au.full_name`,
    [courseRunUuid]
  );
  return r.rows
    .filter((x: { email: string }) => EMAIL_RE.test(x.email))
    .sort((a: { name: string }, b: { name: string }) => (a.name || '').localeCompare(b.name || ''));
}

/** Run `fn` over `items`, `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/**
 * Practice Exam panel on the E-Attendance page: register a class's learners
 * (name + email) on exams.tertiaryinfotech.com for the course's practice exam.
 * Admin / training provider / developer: any class. Trainer: only classes they are assigned to.
 *
 * GET  ?courseRunUuid=                                   → { configured, examCode, learners[], catalog? (staff) }
 * POST { courseRunUuid, action: 'register', emails? }   → register all learners (or just `emails`)
 * POST { courseRunUuid, action: 'set_exam', examCode }  → staff: link/unlink the course's practice exam
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthedApiRequest).authUser!;
  const staff = isStaff(user);

  if (!examsApiConfigured()) {
    if (req.method === 'GET') return res.status(200).json({ success: true, configured: false });
    return res.status(503).json({ success: false, error: 'The Exams integration is not configured (EXAMS_API_TOKEN).' });
  }

  try {
    await ensurePracticeExamColumn();
    const courseRunUuid = String((req.method === 'GET' ? req.query.courseRunUuid : req.body?.courseRunUuid) || '').trim();
    if (!UUID_RE.test(courseRunUuid)) return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
    if (!(await requireCourseRunTrainer(user, res, courseRunUuid))) return;
    const run = await getRun(courseRunUuid);
    if (!run) return res.status(404).json({ success: false, error: 'Class not found' });

    if (req.method === 'GET') {
      let catalog: PracticeExamRef[] | undefined;
      let examTitle: string | null = null;
      let warning: string | null = null;
      if (staff || run.examCode) {
        try {
          const all = await listPracticeExams();
          if (staff) catalog = all;
          const hit = run.examCode
            ? all.find(p => p.slug === run.examCode || p.code.toUpperCase() === run.examCode!.toUpperCase())
            : undefined;
          examTitle = hit?.title ?? null;
          if (run.examCode && !hit) warning = `Practice exam "${run.examCode}" was not found on Tertiary Exams.`;
        } catch (e: any) {
          warning = `Could not reach Tertiary Exams: ${e?.message || 'unknown error'}`;
        }
      }

      const learners = await getLearners(courseRunUuid);
      let registered = new Map<string, ExamRegistration>();
      if (run.examCode && run.courseRunId && !warning) {
        try {
          const regs = await listRegistrations(run.courseRunId, run.examCode);
          registered = new Map(regs.map(r => [r.email.toLowerCase(), r]));
        } catch (e: any) {
          warning = `Could not load registrations: ${e?.message || 'unknown error'}`;
        }
      }

      return res.status(200).json({
        success: true,
        configured: true,
        isStaff: staff,
        course: { id: run.courseId, title: run.courseTitle, courseCode: run.courseCode },
        courseRunId: run.courseRunId,
        examCode: run.examCode,
        examTitle,
        warning,
        catalog,
        learners: learners.map(l => {
          const r = registered.get(l.email);
          return { ...l, registeredAt: r?.registeredAt ?? null, signedIn: r?.signedIn ?? false };
        }),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const { action } = req.body || {};

    if (action === 'set_exam') {
      if (!staff) return res.status(403).json({ success: false, error: 'Only staff can change the course\'s practice exam' });
      const raw = typeof req.body.examCode === 'string' ? req.body.examCode.trim() : '';
      let value: string | null = null;
      if (raw) {
        const all = await listPracticeExams();
        const hit = all.find(p => p.slug === raw) || all.find(p => p.code.toUpperCase() === raw.toUpperCase());
        if (!hit) return res.status(400).json({ success: false, error: `No practice exam matches "${raw}"` });
        // Store the short code unless another vendor uses the same code.
        value = all.filter(p => p.code.toUpperCase() === hit.code.toUpperCase()).length > 1 ? hit.slug : hit.code;
      }
      await pool.query('UPDATE course SET practice_exam_code = $1, updated_at = NOW() WHERE id = $2', [value, run.courseId]);
      return res.status(200).json({ success: true, examCode: value });
    }

    if (action === 'register') {
      if (!run.examCode) return res.status(400).json({ success: false, error: 'This course has no practice exam linked' });
      if (!run.courseRunId) return res.status(400).json({ success: false, error: 'This class has no course run ID' });
      const only: string[] | null = Array.isArray(req.body.emails)
        ? req.body.emails.map((e: unknown) => String(e).trim().toLowerCase())
        : null;
      const learners = (await getLearners(courseRunUuid)).filter(l => !only || only.includes(l.email));
      if (learners.length === 0) return res.status(400).json({ success: false, error: 'No learners to register' });

      const results = await mapLimit(learners, 4, async (l): Promise<RegisterResult & { email: string; name: string }> => {
        try {
          const r = await registerLearner({ name: l.name, email: l.email, exam: run.examCode!, courseRunId: run.courseRunId });
          return { email: l.email, name: l.name, ...r };
        } catch (e: any) {
          return { email: l.email, name: l.name, ok: false, status: 0, error: e?.message || 'Request failed' };
        }
      });
      const failed = results.filter(r => !r.ok).length;
      console.log(`[practice-exam] run ${run.courseRunId} → ${run.examCode}: ${results.length - failed} ok, ${failed} failed (by ${user.id})`);
      return res.status(200).json({
        success: failed === 0,
        registered: results.length - failed,
        failed,
        newAccounts: results.filter(r => r.ok && r.accountCreated).length,
        results,
      });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (err: any) {
    console.error('[practice-exam course-run] failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
