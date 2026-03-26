import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';

/**
 * GET  /api/admin/ssg-get-course-run?courseRunId=xxx
 * POST /api/admin/ssg-get-course-run  body: { courseRunId }
 *
 * Fetches a single course run from SSG by ID.
 * Returns: { data: { course: { referenceNumber, title, run: { id, qrCodeLink, courseStartDate, courseEndDate, ... } } } }
 * courseStartDate / courseEndDate are normalised from courseDates.start/end (YYYYMMDD integers).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const courseRunId = (
    req.method === 'GET' ? req.query.courseRunId : req.body?.courseRunId
  ) as string | undefined;

  if (!courseRunId?.trim()) {
    return res.status(400).json({ error: 'courseRunId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGCourseAPI(ssgBaseUrl, credentials);
    const result = await api.viewCourseRun(courseRunId.trim());

    const hasError = result.error && (
      result.error.code ||
      result.error.message ||
      (result.error.details && result.error.details.length > 0)
    );

    if (hasError) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    // Normalise date fields: SSG uses courseDates.start/end; consumers expect courseStartDate/courseEndDate
    const course = result.data?.course;
    if (course?.run) {
      const run = course.run;
      run.courseStartDate = run.courseStartDate ?? run.courseDates?.start;
      run.courseEndDate   = run.courseEndDate   ?? run.courseDates?.end;
    }

    return res.status(200).json({ data: result.data });

  } catch (error) {
    console.error('[ssg-get-course-run] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
