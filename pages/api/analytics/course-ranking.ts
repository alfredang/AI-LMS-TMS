import { withAuth } from '@lib/auth/withAuth';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { parseFilters } from '../../../lib/analytics/filters';
import { loadCourseRanking } from '../../../lib/analytics/ranking';

/**
 * Popular Courses ranking for the Training Analytics dashboard.
 *
 * Query params (all optional): period=all|ytd|3m|6m|12m|24m|36m,
 * courseType=<course.course_type>|Other, sponsorship=employer|individual.
 * Separate from /api/analytics/dashboard so the card's own period select
 * refreshes only this chart.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const f = parseFilters(req.query);
    const courses = await loadCourseRanking(f);
    res.status(200).json({ success: true, data: { period: f.period, courses } });
  } catch (error) {
    console.error('❌ Error fetching course ranking:', error);
    res.status(500).json({ success: false, error: 'Failed to load course ranking' });
  }
}

export default withAuth(handler);
