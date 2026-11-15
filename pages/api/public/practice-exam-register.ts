import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { limited } from '../../../lib/android/auth';
import { ensurePracticeExamColumn, examsApiConfigured, listPracticeExams, registerLearner } from '../../../lib/practiceExam/examsApi';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID = 'This practice exam link is not valid.';

/**
 * PUBLIC: the /practice-exam/[runId] page a learner reaches by scanning the class's Self Register
 * QR code (shown by the trainer from the Practice Exam section). The link carries the class's
 * unguessable UUID.
 *
 * GET  ?run=                 → the class and practice exam shown on the form
 * POST { run, name, email }  → register that person on Tertiary Exams for the course's practice exam
 *
 * The exams site creates the account if the email is new, assigns the practice exam, records the
 * course run ID with the remark "Self-registered from TMS", and emails the exam link; the learner
 * proves the inbox is theirs by signing in with an email code. Open from 14 days before the class
 * starts until 30 days after it ends. Rate limited per IP (generous: a class shares the venue
 * Wi-Fi) and per email. Returns nothing about anyone else on the class.
 */
function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

async function getRun(runUuid: string) {
  const r = await pool.query(
    `SELECT cr.course_run_id, cr.start_date::text AS start_date, cr.end_date::text AS end_date,
            c.title, c.practice_exam_code,
            (COALESCE(cr.is_deleted, false) = false
              AND cr.class_status IS DISTINCT FROM 'Cancelled'
              AND (cr.start_date IS NULL OR (NOW() AT TIME ZONE 'Asia/Singapore')::date >= cr.start_date - 14)
              AND (cr.end_date IS NULL OR (NOW() AT TIME ZONE 'Asia/Singapore')::date <= cr.end_date + 30)) AS open
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1`,
    [runUuid]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    courseRunId: String(row.course_run_id || '').trim(),
    title: row.title as string,
    startDate: row.start_date as string | null,
    endDate: row.end_date as string | null,
    examCode: row.practice_exam_code ? String(row.practice_exam_code).trim() || null : null,
    open: !!row.open,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const runUuid = String((req.method === 'GET' ? req.query.run : req.body?.run) || '').trim();
  if (!UUID_RE.test(runUuid)) return res.status(400).json({ success: false, error: INVALID });

  try {
    if (!(await examsApiConfigured())) return res.status(404).json({ success: false, error: INVALID });
    await ensurePracticeExamColumn();
    const run = await getRun(runUuid);
    if (!run || !run.examCode) return res.status(404).json({ success: false, error: INVALID });
    const available = run.open && !!run.courseRunId;

    if (req.method === 'GET') {
      let examTitle: string = run.examCode;
      try {
        const hit = (await listPracticeExams()).find(p => p.slug === run.examCode || p.code.toUpperCase() === run.examCode!.toUpperCase());
        if (hit) examTitle = hit.title;
      } catch { /* the title is cosmetic */ }
      return res.status(200).json({
        success: true,
        available,
        examTitle,
        course: { title: run.title, courseRunId: run.courseRunId, startDate: run.startDate, endDate: run.endDate },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    if (!available) return res.status(409).json({ success: false, error: 'This class is not open for practice exam registration.' });

    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fieldErrors: Record<string, string> = {};
    if (name.length < 2 || name.length > 200) fieldErrors.name = 'Enter your full name.';
    if (!EMAIL_RE.test(email) || email.length > 320) fieldErrors.email = 'Enter a valid email address.';
    if (Object.keys(fieldErrors).length) return res.status(400).json({ success: false, error: 'Please correct the highlighted fields.', fieldErrors });

    if (await limited(`practice-exam-register:ip:${clientIp(req)}`, 200, 60)
      || await limited(`practice-exam-register:email:${runUuid}:${email}`, 5, 60)) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later or ask your trainer.' });
    }

    const r = await registerLearner({ name, email, exam: run.examCode, courseRunId: run.courseRunId, remark: 'Self-registered from TMS' });
    if (!r.ok) {
      console.error(`[public practice-exam-register] run ${run.courseRunId}: exams API ${r.status}`);
      return res.status(502).json({ success: false, error: 'We could not register you just now. Please try again or ask your trainer.' });
    }
    return res.status(200).json({ success: true, registered: true, emailSent: !!r.emailSent });
  } catch (err: any) {
    console.error('[public practice-exam-register] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
}
