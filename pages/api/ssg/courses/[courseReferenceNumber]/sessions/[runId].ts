import { withAuth } from '@lib/auth/withAuth';
/**
 * Next.js API route for course sessions
 * GET /api/ssg/courses/[courseReferenceNumber]/sessions/[runId] - View course sessions
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { OptionalSelector } from '../../../../../../lib/ssg/models/course-runs';
import { createSSGCourseAPI } from '../../../../../../lib/ssg/api/course-api';
import { getSSGCredentialsService } from '../../../../../../lib/ssg/services/credentials-service';

// Helper function to get optional selector from query
const getOptionalSelector = (value: string | string[] | undefined): OptionalSelector => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' ? OptionalSelector.YES : OptionalSelector.NO;
  }
  return OptionalSelector.NO;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Base URL loaded from credentials (DB-first) in step below

    const { courseReferenceNumber, runId, includeExpired, month, year } = req.query;

    if (!courseReferenceNumber || typeof courseReferenceNumber !== 'string') {
      return res.status(400).json({ error: 'courseReferenceNumber is required' });
    }

    if (!runId || typeof runId !== 'string') {
      return res.status(400).json({ error: 'runId is required' });
    }

    // Get SSG credentials from database (using the single training provider)
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);

    if (!credentials) {
      return res.status(404).json({ error: 'Training provider credentials not found' });
    }

    // Validate credentials
    const validationErrors = credentialsService.validateCredentials(credentials);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Invalid SSG credentials',
        message: `Credential validation failed: ${validationErrors.join(', ')}`
      });
    }

    // Create SSG API client
    const ssgAPI = createSSGCourseAPI(credentials.ssgApiBaseUrl, credentials);

    const includeExpiredOption = getOptionalSelector(includeExpired);
    
    // Call the API method (pass month and year if provided)
    const result = await ssgAPI.viewCourseSessions(
      courseReferenceNumber, 
      runId, 
      includeExpiredOption,
      month ? parseInt(month as string) : undefined,
      year ? parseInt(year as string) : undefined
    );

    if (result.error) {
      return res.status(result.status || 400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Course Sessions API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
