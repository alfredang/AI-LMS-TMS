import { withAuth } from '@lib/auth/withAuth';
/**
 * Next.js API routes for SSG course operations
 * GET /api/ssg/courses/[runId] - View course run by ID
 * POST /api/ssg/courses - Add new course run
 * PUT /api/ssg/courses - Edit existing course run
 * DELETE /api/ssg/courses - Delete course run
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { 
  AddRunInfo, 
  EditRunInfo, 
  DeleteRunInfo, 
  OptionalSelector 
} from '../../../lib/ssg/models/course-runs';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import {
  extractCourseRun,
  normalizeCourseRunResponse,
  toHttpErrorStatus,
} from '../../../lib/ssg/course-run-response';
import pool from '../../../lib/db';

// Get base URL from credentials (DB-first, env fallback)
const getBaseUrl = async () => {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  return credentials?.ssgApiBaseUrl || 'https://api.ssg-wsg.sg';
};

// Helper function to get optional selector from query
const getOptionalSelector = (value: string | string[] | undefined): OptionalSelector => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' ? OptionalSelector.YES : OptionalSelector.NO;
  }
  return OptionalSelector.NO;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const baseUrl = await getBaseUrl();

    // Get training provider ID from request (optional, defaults to first available)
    const trainingProviderId = req.query.trainingProviderId as string;
    
    // Parse training provider ID, handling empty string case
    let trainingProviderIdNum: number | undefined;
    if (trainingProviderId && trainingProviderId.trim() !== '') {
      trainingProviderIdNum = parseInt(trainingProviderId, 10);
      if (isNaN(trainingProviderIdNum)) {
        return res.status(400).json({ 
          error: 'Invalid trainingProviderId',
          message: 'trainingProviderId must be a valid number'
        });
      }
    }
    
    // Retrieve SSG credentials from database. The x-ssg-app header (set by
    // SsgAppSelector's fetch interceptor — values: app1 / app2 / app3 / app4)
    // lets the admin pick which SSG cert profile to use at runtime. Without
    // this second arg, the header is silently ignored and the default app is
    // always used — which is what was causing the "App 2 selected but App 1
    // behavior" bug on local.
    const appOverride = (req.headers['x-ssg-app'] as string) || undefined;
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials(trainingProviderIdNum, appOverride);

    if (!credentials) {
      return res.status(400).json({ 
        error: 'No SSG credentials found in database',
        message: 'Please ensure your training provider has SSG credentials configured in the database'
      });
    }

    // Validate credentials
    const validationErrors = credentialsService.validateCredentials(credentials);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Invalid SSG credentials',
        message: `Credential validation failed: ${validationErrors.join(', ')}`
      });
    }

    // Create SSG API client with database credentials
    const ssgAPI = createSSGCourseAPI(baseUrl, credentials);

    switch (req.method) {
      case 'GET':
        await handleGetCourseRun(req, res, ssgAPI);
        break;
      case 'POST':
        await handleAddCourseRun(req, res, ssgAPI);
        break;
      case 'PUT':
        await handleEditCourseRun(req, res, ssgAPI);
        break;
      case 'DELETE':
        await handleDeleteCourseRun(req, res, ssgAPI);
        break;
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('SSG API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGetCourseRun(
  req: NextApiRequest, 
  res: NextApiResponse, 
  ssgAPI: any
) {
  const { runId, includeExpired } = req.query;

  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ error: 'runId is required' });
  }

  const includeExpiredOption = getOptionalSelector(includeExpired);
  const result = await ssgAPI.viewCourseRun(runId, includeExpiredOption);

  const hasSsgError = !!(
    result.error &&
    (result.error.code || result.error.message || (Array.isArray(result.error.details) && result.error.details.length > 0))
  );

  if (hasSsgError) {
    const errorStatus = toHttpErrorStatus(result.status);

    return res.status(errorStatus).json({
      ...result,
      status: errorStatus,
    });
  }

  const normalizedResult = normalizeCourseRunResponse(result);

  if (!extractCourseRun(normalizedResult)) {
    const missingRunStatus = toHttpErrorStatus(normalizedResult?.status);
    const data = normalizedResult?.data && typeof normalizedResult.data === 'object'
      ? normalizedResult.data as Record<string, unknown>
      : null;

    console.warn('[api/ssg/courses] SSG response did not contain a course run:', {
      runId,
      responseKeys: normalizedResult && typeof normalizedResult === 'object'
        ? Object.keys(normalizedResult)
        : [],
      dataKeys: data ? Object.keys(data) : [],
    });

    return res.status(missingRunStatus).json({
      ...normalizedResult,
      error: {
        code: 'SSG_COURSE_RUN_MISSING',
        message: 'SSG returned a response without course run data',
      },
      status: missingRunStatus,
    });
  }

  await enrichCourseRunWithLocalVirtualMeeting(normalizedResult, runId);

  res.status(200).json(normalizedResult);
}

async function enrichCourseRunWithLocalVirtualMeeting(result: any, runId: string) {
  try {
    const localResult = await pool.query(
      `SELECT
         virtual_meeting_link,
         virtual_meeting_provider,
         virtual_meeting_external_id,
         virtual_meeting_status,
         virtual_meeting_synced_at
       FROM course_run
       WHERE course_run_id = $1
       LIMIT 1`,
      [runId]
    );

    const local = localResult.rows[0];
    if (!local || !result?.data) return;

    const virtualMeetingFields = {
      virtualMeetingLink: local.virtual_meeting_link || null,
      virtualMeetingProvider: local.virtual_meeting_provider || null,
      virtualMeetingExternalId: local.virtual_meeting_external_id || null,
      virtualMeetingStatus: local.virtual_meeting_status || null,
      virtualMeetingSyncedAt: local.virtual_meeting_synced_at || null,
    };

    const runTargets = [
      result.data.run,
      result.data.course?.run,
    ].filter((target) => target && typeof target === 'object');

    for (const run of runTargets) {
      Object.assign(run, virtualMeetingFields);
    }

    Object.assign(result.data, virtualMeetingFields);
  } catch (error) {
    console.warn('[api/ssg/courses] Failed to enrich virtual meeting fields:', error);
  }
}

async function handleAddCourseRun(
  req: NextApiRequest, 
  res: NextApiResponse, 
  ssgAPI: any
) {
  const { includeExpired } = req.query;
  const runInfo: AddRunInfo = req.body;

  if (!runInfo) {
    return res.status(400).json({ error: 'Course run information is required' });
  }

  // Basic validation
  if (!runInfo.course?.courseReferenceNumber || !runInfo.course?.trainingProvider?.uen) {
    return res.status(400).json({ 
      error: 'Course reference number and training provider UEN are required' 
    });
  }

  const includeExpiredOption = getOptionalSelector(includeExpired);
  const result = await ssgAPI.addCourseRun(runInfo, includeExpiredOption);

  if (result.error) {
    return res.status(result.status || 400).json(result);
  }

  res.status(201).json(result);
}

async function handleEditCourseRun(
  req: NextApiRequest, 
  res: NextApiResponse, 
  ssgAPI: any
) {
  const { includeExpired } = req.query;
  const runInfo: EditRunInfo = req.body;

  if (!runInfo) {
    return res.status(400).json({ error: 'Course run information is required' });
  }

  // Basic validation
  if (!runInfo.course?.courseReferenceNumber || !runInfo.run?.id) {
    return res.status(400).json({ 
      error: 'Course reference number and run ID are required' 
    });
  }

  const includeExpiredOption = getOptionalSelector(includeExpired);
  const result = await ssgAPI.editCourseRun(runInfo, includeExpiredOption);

  if (result.error) {
    return res.status(result.status || 400).json(result);
  }

  res.status(200).json(result);
}

async function handleDeleteCourseRun(
  req: NextApiRequest, 
  res: NextApiResponse, 
  ssgAPI: any
) {
  const { includeExpired } = req.query;
  const runInfo: DeleteRunInfo = req.body;

  if (!runInfo) {
    return res.status(400).json({ error: 'Course run information is required' });
  }

  // Basic validation
  if (!runInfo.course?.courseReferenceNumber || !runInfo.run?.id) {
    return res.status(400).json({ 
      error: 'Course reference number and run ID are required' 
    });
  }

  const includeExpiredOption = getOptionalSelector(includeExpired);
  const result = await ssgAPI.deleteCourseRun(runInfo, includeExpiredOption);

  if (result.error) {
    return res.status(result.status || 400).json(result);
  }

  res.status(200).json(result);
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
