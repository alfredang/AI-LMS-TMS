import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { setCourseFee } from '../../../lib/courseFeeCheck';

/**
 * POST /api/admin/ca-course-fee-set
 * Body: { courseId, courseReferenceNumber, fee, updateQuickBooks }
 *
 * Saves the correct course fee entered in the Company Application fee popup,
 * so every later enrolment and invoice for the course uses it. Optionally sets
 * the QuickBooks product price to match.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const courseId = String(req.body?.courseId || '').trim();
  const courseReferenceNumber = String(req.body?.courseReferenceNumber || '').trim().toUpperCase();
  const fee = Number(req.body?.fee);
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) {
    return res.status(400).json({ success: false, error: 'courseId is required' });
  }
  try {
    const result = await setCourseFee(courseId, courseReferenceNumber, fee, {
      updateQuickBooks: req.body?.updateQuickBooks === true,
      changedBy: (req as AuthedApiRequest).authUser?.id || 'unknown',
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save the course fee';
    return res.status(400).json({ success: false, error: message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
