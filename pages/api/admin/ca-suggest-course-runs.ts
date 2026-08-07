import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { findCourseRunCandidates } from '../../../lib/companyApplicationValidator';

/**
 * POST /api/admin/ca-suggest-course-runs
 * Body: { groups: [{ courseTitle, courseStartDate }] }   // courseStartDate = DD-MM-YYYY, as typed in the Excel
 *
 * Suggests which course run each (title, date) group in a Company Application
 * upload probably refers to, so the confirmation popup can offer a click instead
 * of asking the admin to go and look the ID up.
 *
 * Read-only and advisory: the admin's typed/selected run ID is what counts, and
 * it is verified server-side on upload. Suggestions never auto-apply — employer
 * titles drift enough that "looks close" is regularly a different course.
 */

interface SuggestGroup {
  courseTitle: string;
  courseStartDate: string;
}

function parseDdMmYyyy(raw: string): string | null {
  const m = String(raw || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const groups = Array.isArray(req.body?.groups) ? (req.body.groups as SuggestGroup[]) : [];
  if (groups.length === 0) return res.status(200).json({ success: true, suggestions: [] });
  if (groups.length > 50) {
    return res.status(400).json({ success: false, error: 'Too many course groups in one upload (max 50).' });
  }

  try {
    const suggestions = [];
    for (const g of groups) {
      const courseTitle = String(g?.courseTitle ?? '');
      const courseStartDate = String(g?.courseStartDate ?? '');
      const iso = parseDdMmYyyy(courseStartDate);
      suggestions.push({
        courseTitle,
        courseStartDate,
        candidates: iso ? await findCourseRunCandidates(courseTitle, iso) : [],
      });
    }
    return res.status(200).json({ success: true, suggestions });
  } catch (err: any) {
    console.error('[ca-suggest-course-runs] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to suggest course runs' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
