import { withAuth } from '@lib/auth/withAuth';
/**
 * ARCHIVED — not called by any UI as of 2026-06-02.
 *
 * Original purpose: insert local course_run placeholder rows for Magento
 * schedules that are missing from SSG, without actually submitting to SSG.
 * The "Bulk Stage Missing" button in WsqScheduleSyncView used this endpoint.
 *
 * Why it was replaced:
 *   - Staged rows used a fake course_run_id ("STAGED-{code}-{date}") that was
 *     never automatically replaced with a real SSG run ID after submission.
 *     The subsequent SSG submission (via save-course-run.ts) inserted a SECOND
 *     row with the real run ID, leaving the staged row orphaned.
 *   - Because staged rows matched on dates, the wsq-schedule-sync comparison
 *     showed them as "synced" even though SSG had no record — hiding genuinely
 *     missing runs.
 *
 * Replacement: submit-to-ssg.ts
 *   - Submits directly to SSG in one step.
 *   - Writes the real SSG run ID to course_run on success.
 *   - If a STAGED- row already exists for the same course/dates, updates it
 *     in-place rather than creating a duplicate.
 *
 * Keep this file if a two-phase staging workflow is ever needed again
 * (e.g. manual review before SSG submission).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../../lib/courseCode';

type StageItem = {
  course_code: string;
  start_date: string;
  end_date: string;
};

type StageResult = {
  course_code: string;
  start_date: string;
  end_date: string;
  status: 'created' | 'exists' | 'no_course' | 'error';
  local_run_id?: string;
  message?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const items = Array.isArray(req.body?.items) ? (req.body.items as StageItem[]) : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const results: StageResult[] = [];

  for (const item of items) {
    const { course_code, start_date, end_date } = item || ({} as StageItem);
    if (!course_code || !start_date || !end_date) {
      results.push({ course_code, start_date, end_date, status: 'error', message: 'missing fields' });
      continue;
    }
    try {
      const courseR = await pool.query<{ id: string }>(
        COURSE_ID_BY_ANY_CODE_SQL,
        [course_code],
      );
      if (courseR.rows.length === 0) {
        results.push({ course_code, start_date, end_date, status: 'no_course', message: 'course not found locally — add it in Course Management first' });
        continue;
      }
      const courseId = courseR.rows[0].id;

      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM course_run
          WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date AND is_deleted = false
          LIMIT 1`,
        [courseId, start_date, end_date],
      );
      if (existing.rows.length > 0) {
        results.push({ course_code, start_date, end_date, status: 'exists', local_run_id: existing.rows[0].id });
        continue;
      }

      // Placeholder course_run_id — admin overwrites this with the real SSG run id once published.
      const placeholder = `STAGED-${course_code}-${start_date}`;
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO course_run (course_id, course_run_id, start_date, end_date, class_status)
         VALUES ($1, $2, $3::date, $4::date, 'Pending')
         RETURNING id`,
        [courseId, placeholder, start_date, end_date],
      );
      results.push({ course_code, start_date, end_date, status: 'created', local_run_id: inserted.rows[0].id });
    } catch (e: any) {
      results.push({ course_code, start_date, end_date, status: 'error', message: e?.message || String(e) });
    }
  }

  const summary = {
    created:   results.filter((r) => r.status === 'created').length,
    exists:    results.filter((r) => r.status === 'exists').length,
    no_course: results.filter((r) => r.status === 'no_course').length,
    error:     results.filter((r) => r.status === 'error').length,
  };
  return res.status(200).json({ summary, results });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
