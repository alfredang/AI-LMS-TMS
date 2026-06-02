import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getSSGCredentialsService } from '../../../../lib/ssg/services/credentials-service';
import { HTTPRequestBuilder, HttpMethod, HttpClient, handleRequest } from '../../../../lib/ssg/utils/http-utils';

/**
 * POST /api/admin/wsq-schedule-sync/refresh-support-periods
 *
 * For every TGS course in the local DB, calls SSG's courseRuns/reference
 * endpoint (pageSize=1) and extracts the WSQ support period (taggingCode "1000")
 * from the supports[] array. Stores the result on course.ssg_wsq_support_from/to.
 *
 * Processes up to 5 courses concurrently to avoid SSG rate-limiting.
 * Returns a summary of updated / unchanged / failed courses.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Load SSG credentials
  let credentials: Awaited<ReturnType<ReturnType<typeof getSSGCredentialsService>['getSSGCredentials']>>;
  let ssgBaseUrl = 'https://api.ssg-wsg.sg';
  try {
    const credsSvc = getSSGCredentialsService();
    credentials = await credsSvc.getSSGCredentials(
      undefined,
      (req.headers['x-ssg-app'] as string) || undefined,
    );
    if (!credentials) return res.status(503).json({ error: 'SSG credentials not configured' });
    ssgBaseUrl = credentials.ssgApiBaseUrl || ssgBaseUrl;
  } catch (e: any) {
    return res.status(500).json({ error: 'Failed to load SSG credentials', message: e?.message });
  }

  // Get all TGS course codes from local DB
  const coursesResult = await pool.query<{ id: string; course_code: string }>(
    `SELECT id, course_code FROM course WHERE course_code LIKE 'TGS-%' ORDER BY course_code`,
  );
  const courses = coursesResult.rows;

  const summary = { updated: 0, unchanged: 0, no_wsq_support: 0, ssg_error: 0 };
  const errors: { course_code: string; message: string }[] = [];

  // Process in batches of 5 concurrent calls
  const BATCH = 5;
  for (let i = 0; i < courses.length; i += BATCH) {
    const batch = courses.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async ({ id, course_code }) => {
      try {
        const builder = new HTTPRequestBuilder()
          .withEndpoint(ssgBaseUrl, '/courses/courseRuns/reference')
          .withMethod(HttpMethod.GET)
          .withParam('courseReferenceNumber', course_code)
          .withParam('uen', credentials!.uen || '')
          .withParam('page', '0')
          .withParam('pageSize', '1')
          .withParam('includeExpiredCourses', 'true');

        if (credentials!.certificateContent && credentials!.privateKeyContent) {
          builder.withCertificate(credentials!.certificateContent, credentials!.privateKeyContent);
        }

        const config = builder.build();
        const httpClient = new HttpClient(ssgBaseUrl, { Accept: 'application/json' });
        const result = await handleRequest(httpClient, config);

        if (result.error?.code || result.error?.message) {
          summary.ssg_error++;
          errors.push({ course_code, message: result.error.message || 'SSG error' });
          return;
        }

        const supports: any[] = (result.data as any)?.course?.supports ?? [];
        const wsq = supports.find((s: any) => s?.period?.taggingCode === '1000');

        if (!wsq?.period?.from || !wsq?.period?.to) {
          summary.no_wsq_support++;
          // Store NULLs explicitly so the UI knows we checked
          await pool.query(
            `UPDATE course SET ssg_wsq_support_from = NULL, ssg_wsq_support_to = NULL,
               ssg_wsq_support_refreshed_at = NOW() WHERE id = $1`,
            [id],
          );
          return;
        }

        // Convert YYYYMMDD integer to YYYY-MM-DD string
        const toDate = (n: number) => {
          const s = String(n);
          return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        };
        const from = toDate(wsq.period.from);
        const to   = toDate(wsq.period.to);

        await pool.query(
          `UPDATE course SET ssg_wsq_support_from = $1::date, ssg_wsq_support_to = $2::date,
             ssg_wsq_support_refreshed_at = NOW() WHERE id = $3`,
          [from, to, id],
        );
        summary.updated++;
      } catch (e: any) {
        summary.ssg_error++;
        errors.push({ course_code, message: e?.message || String(e) });
      }
    }));
  }

  return res.status(200).json({ summary, total: courses.length, errors: errors.slice(0, 20) });
}
