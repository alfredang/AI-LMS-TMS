import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { isStaff } from '../../../lib/auth/courseRunAccess';
import { ensurePracticeExamColumn, examsApiConfigured, listPracticeExams, type PracticeExamRef } from '../../../lib/practiceExam/examsApi';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Course editor → Course Settings → Practice Exam. Whether a course has a practice
 * exam on Tertiary Exams, and which one (`course.practice_exam_code`). Staff only.
 *
 * GET  ?courseId=             → { configured, examCode, catalog[] }
 * POST { courseId, examCode } → link the course to an exam; empty examCode turns it off
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthedApiRequest).authUser!;
  if (!isStaff(user)) return res.status(403).json({ success: false, error: 'Forbidden' });

  if (!(await examsApiConfigured())) {
    if (req.method === 'GET') return res.status(200).json({ success: true, configured: false });
    return res.status(503).json({ success: false, error: 'The AI Exam integration is not configured (Company Settings → Integrations → AI Exam).' });
  }

  try {
    await ensurePracticeExamColumn();
    const courseId = String((req.method === 'GET' ? req.query.courseId : req.body?.courseId) || '').trim();
    if (!UUID_RE.test(courseId)) return res.status(400).json({ success: false, error: 'courseId is required' });
    const found = await pool.query('SELECT practice_exam_code FROM course WHERE id = $1', [courseId]);
    if (found.rowCount === 0) return res.status(404).json({ success: false, error: 'Course not found' });
    const current: string | null = found.rows[0].practice_exam_code ? String(found.rows[0].practice_exam_code).trim() || null : null;

    if (req.method === 'GET') {
      let catalog: PracticeExamRef[] = [];
      let warning: string | null = null;
      try {
        catalog = await listPracticeExams();
      } catch (e: any) {
        warning = `Could not reach Tertiary Exams: ${e?.message || 'unknown error'}`;
      }
      return res.status(200).json({ success: true, configured: true, examCode: current, catalog, warning });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const raw = typeof req.body?.examCode === 'string' ? req.body.examCode.trim() : '';
    let value: string | null = null;
    if (raw) {
      const all = await listPracticeExams();
      const hit = all.find(p => p.slug === raw) || all.find(p => p.code.toUpperCase() === raw.toUpperCase());
      if (!hit) return res.status(400).json({ success: false, error: `No practice exam matches "${raw}"` });
      // Store the short code unless another vendor uses the same code.
      value = all.filter(p => p.code.toUpperCase() === hit.code.toUpperCase()).length > 1 ? hit.slug : hit.code;
    }
    await pool.query('UPDATE course SET practice_exam_code = $1, updated_at = NOW() WHERE id = $2', [value, courseId]);
    return res.status(200).json({ success: true, examCode: value });
  } catch (err: any) {
    console.error('[practice-exam course] failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
