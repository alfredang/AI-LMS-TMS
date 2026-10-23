import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { checkCourseFees, CourseFeeCheckItem } from '../../../lib/courseFeeCheck';

/**
 * POST /api/admin/ca-course-fee-check
 * Body: { items: [{ courseRunId?, courseReferenceNumber?, courseTitle? }] }
 *
 * Read-only pre-flight for Company Application enrolment / invoicing: reports
 * courses whose LMS fee is blank or disagrees with the QuickBooks product.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const raw: unknown[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  const items: CourseFeeCheckItem[] = raw.map((i: any) => ({
    courseRunId: i?.courseRunId,
    courseReferenceNumber: i?.courseReferenceNumber,
    courseTitle: i?.courseTitle,
  }));
  try {
    const result = await checkCourseFees(items);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[ca-course-fee-check] failed:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Fee check failed' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
