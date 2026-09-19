import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { RUN_COURSE_CODE_SQL } from '../../../lib/courseCode';
import { findCourseRunCandidates } from '../../../lib/companyApplicationValidator';

function parseApplicationStartDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const applicationId = String(req.body?.applicationId || '').trim();
  const courseRunId = String(req.body?.courseRunId || '').trim();
  if (!applicationId || !courseRunId) {
    return res.status(400).json({ success: false, error: 'applicationId and courseRunId are required' });
  }

  const application = (await pool.query(
    `SELECT id, course_title, course_start_date, enrolment_id
       FROM public.company_application
      WHERE id = $1
      LIMIT 1`,
    [applicationId],
  )).rows[0];

  if (!application) {
    return res.status(404).json({ success: false, error: 'Company application row not found' });
  }

  if (String(application.enrolment_id || '').trim()) {
    return res.status(409).json({
      success: false,
      error: 'This learner already has an enrolment ID, so the course run cannot be changed here.',
    });
  }

  const title = String(application.course_title || '').trim();
  const startDate = parseApplicationStartDate(String(application.course_start_date || ''));
  if (!title || !startDate) {
    return res.status(400).json({
      success: false,
      error: 'This row has no valid course title/start date to match against.',
    });
  }

  const candidates = await findCourseRunCandidates(title, startDate);
  if (!candidates.some(candidate => candidate.courseRunId === courseRunId)) {
    return res.status(400).json({
      success: false,
      error: `Course run ${courseRunId} is not a candidate for this learner's course/date.`,
    });
  }

  const run = (await pool.query(
    `SELECT cr.course_run_id::text AS course_run_id,
            ${RUN_COURSE_CODE_SQL}::text AS course_reference_number,
            c.title::text AS course_title,
            cr.start_date::text AS start_date,
            cr.end_date::text AS end_date
       FROM public.course_run cr
       JOIN public.course c ON c.id = cr.course_id
      WHERE cr.course_run_id = $1
        AND COALESCE(cr.is_deleted, false) = false
      LIMIT 1`,
    [courseRunId],
  )).rows[0];

  if (!run) {
    return res.status(404).json({ success: false, error: `Course run ${courseRunId} not found` });
  }

  const updated = (await pool.query(
    `UPDATE public.company_application
        SET course_run_id = $2,
            course_reference_number = $3,
            auto_enrol_status = 'pending',
            auto_enrol_error = NULL,
            updated_at = now()
      WHERE id = $1
        AND enrolment_id IS NULL
      RETURNING id`,
    [applicationId, run.course_run_id, run.course_reference_number],
  )).rows[0];

  if (!updated) {
    return res.status(404).json({ success: false, error: 'Company application row not found' });
  }

  return res.status(200).json({
    success: true,
    run: {
      courseRunId: run.course_run_id,
      courseReferenceNumber: run.course_reference_number,
      courseTitle: run.course_title,
      startDate: String(run.start_date || '').slice(0, 10),
      endDate: String(run.end_date || '').slice(0, 10),
    },
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
