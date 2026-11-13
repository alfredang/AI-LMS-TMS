import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { refreshCourseAvailabilityBatch } from '../../../../lib/ssg/courseAvailability';

/**
 * Refresh the SSG support period, future-run signal, and authoritative course
 * availability state. The endpoint stays resumable because SSG rate-limits
 * course lookups; the admin UI calls it in batches until remaining reaches 0.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await refreshCourseAvailabilityBatch({
      batchSize: req.body?.batch_size,
      maxAgeHours: req.body?.max_age_hours,
      refreshedBefore: req.body?.refreshed_before,
      ssgApp: (req.headers['x-ssg-app'] as string) || undefined,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to refresh SSG course availability',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
