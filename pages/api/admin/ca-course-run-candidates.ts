import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { findCourseRunCandidates } from '../../../lib/companyApplicationValidator';

function parseDdMmYyyy(raw: string): string | null {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw.trim();

  const match = raw.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const applicationId = String(req.query.applicationId || '').trim();
  if (!applicationId) {
    return res.status(400).json({ success: false, error: 'applicationId is required' });
  }

  const row = (await pool.query(
    `SELECT id, trainee_full_name, course_title, course_start_date, auto_enrol_error
       FROM public.company_application
      WHERE id = $1
      LIMIT 1`,
    [applicationId],
  )).rows[0];

  if (!row) {
    return res.status(404).json({ success: false, error: 'Company application row not found' });
  }

  const title = String(row.course_title || '').trim();
  const startDate = parseDdMmYyyy(String(row.course_start_date || ''));
  if (!title || !startDate) {
    return res.status(400).json({
      success: false,
      error: 'This row has no valid course title/start date to match against.',
    });
  }

  const candidates = await findCourseRunCandidates(title, startDate);

  return res.status(200).json({
    success: true,
    application: {
      id: row.id,
      traineeName: row.trainee_full_name,
      courseTitle: title,
      courseStartDate: row.course_start_date,
      autoEnrolError: row.auto_enrol_error,
    },
    candidates,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
