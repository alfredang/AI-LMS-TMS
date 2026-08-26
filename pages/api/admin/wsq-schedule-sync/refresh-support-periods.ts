import { withAuth } from '@lib/auth/withAuth';
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
 * SSG rate-limits this endpoint hard: the first version fired 5 concurrent calls
 * with no pacing and no retry, which got ~20 courses through and then failed the
 * remaining ~286 with "Too Many Requests" on every run. So:
 *   - low concurrency plus a gap between rounds,
 *   - exponential backoff retry on throttling,
 *   - and the call is RESUMABLE: it only picks up courses not refreshed within
 *     max_age_hours, capped at batch_size, and reports how many are left. The
 *     caller loops until `remaining` hits 0 rather than holding one long request
 *     open, which would time out well before 306 paced calls complete.
 *
 * A course that errors keeps its old ssg_wsq_support_refreshed_at, so the next
 * call picks it up again. Only a successful lookup stamps the timestamp.
 *
 * Body (all optional):
 *   batch_size      courses to process this call (default 50, max 150)
 *   max_age_hours   treat a course as done if refreshed within this window (default 12)
 *
 * Each call is also capped at TIME_BUDGET_MS of wall clock, so it always returns
 * promptly even when SSG is throttling every request.
 *
 * Returns { summary, processed, remaining, total, stopped_early, errors }
 */

const CONCURRENCY = 2;
const ROUND_GAP_MS = 300;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1500; // 1.5s, 3s, 6s, 12s
// Hard wall-clock budget for ONE request. A fully-throttled batch would otherwise
// back off ~22s per course and hold the request open for minutes, tripping a proxy
// timeout. Instead we stop cleanly and report what is left; the caller loops.
const TIME_BUDGET_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SSG signals throttling as "Too Many Requests" / HTTP 429. */
function isThrottled(err: any): boolean {
  const t = [err?.code, err?.message, err?.status].join(' ').toLowerCase();
  return t.includes('too many requests') || t.includes('429') || t.includes('rate limit');
}

// Courses we have not refreshed recently — this is what makes the call resumable.
const STALE_WHERE = `course_code LIKE 'TGS-%'
     AND (ssg_wsq_support_refreshed_at IS NULL
          OR ssg_wsq_support_refreshed_at < NOW() - ($1 || ' hours')::interval)`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startedAt = Date.now();
  const msLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  const batchSize = Math.min(Math.max(Number(req.body?.batch_size) || 50, 1), 150);
  const maxAgeHours = Math.max(Number(req.body?.max_age_hours) || 12, 0);

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

  const totalR = await pool.query<{ total: string; stale: string }>(
    `SELECT (SELECT count(*) FROM course WHERE course_code LIKE 'TGS-%') AS total,
            (SELECT count(*) FROM course WHERE ${STALE_WHERE}) AS stale`,
    [String(maxAgeHours)],
  );
  const total = Number(totalR.rows[0]?.total ?? 0);
  const staleCount = Number(totalR.rows[0]?.stale ?? 0);

  const coursesResult = await pool.query<{ id: string; course_code: string }>(
    `SELECT id, course_code FROM course WHERE ${STALE_WHERE} ORDER BY course_code LIMIT $2`,
    [String(maxAgeHours), batchSize],
  );
  const courses = coursesResult.rows;

  const summary = { updated: 0, unchanged: 0, no_wsq_support: 0, ssg_error: 0 };
  const errors: { course_code: string; message: string }[] = [];

  /** One SSG lookup. Retries ONLY on throttling — any other error is real. */
  async function fetchSupport(course_code: string): Promise<{ from: string; to: string } | null> {
    let lastErr: any = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

      const httpClient = new HttpClient(ssgBaseUrl, { Accept: 'application/json' });
      const result = await handleRequest(httpClient, builder.build());

      if (result.error?.code || result.error?.message) {
        lastErr = result.error;
        if (isThrottled(result.error) && attempt < MAX_RETRIES) {
          const wait = BACKOFF_BASE_MS * Math.pow(2, attempt);
          // No budget left to wait it out — give up on this course now. It keeps
          // its old refreshed_at, so the next call retries it from scratch.
          if (wait >= msLeft()) throw new Error(result.error.message || 'SSG error');
          await sleep(wait);
          continue;
        }
        throw new Error(result.error.message || 'SSG error');
      }

      const supports: any[] = (result.data as any)?.course?.supports ?? [];
      const wsq = supports.find((s: any) => s?.period?.taggingCode === '1000');
      if (!wsq?.period?.from || !wsq?.period?.to) return null;

      // Convert YYYYMMDD integer to YYYY-MM-DD string
      const toDate = (n: number) => {
        const s = String(n);
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      };
      return { from: toDate(wsq.period.from), to: toDate(wsq.period.to) };
    }
    throw new Error(lastErr?.message || 'SSG error');
  }

  let attempted = 0;
  let stoppedEarly = false;

  for (let i = 0; i < courses.length; i += CONCURRENCY) {
    if (msLeft() <= 0) { stoppedEarly = true; break; }
    const round = courses.slice(i, i + CONCURRENCY);
    attempted += round.length;
    await Promise.allSettled(round.map(async ({ id, course_code }) => {
      try {
        const period = await fetchSupport(course_code);

        if (!period) {
          summary.no_wsq_support++;
          // Store NULLs explicitly so the UI knows we checked.
          await pool.query(
            `UPDATE course SET ssg_wsq_support_from = NULL, ssg_wsq_support_to = NULL,
               ssg_wsq_support_refreshed_at = NOW() WHERE id = $1`,
            [id],
          );
          return;
        }

        await pool.query(
          `UPDATE course SET ssg_wsq_support_from = $1::date, ssg_wsq_support_to = $2::date,
             ssg_wsq_support_refreshed_at = NOW() WHERE id = $3`,
          [period.from, period.to, id],
        );
        summary.updated++;
      } catch (e: any) {
        // refreshed_at is left untouched, so the next call retries this course.
        summary.ssg_error++;
        errors.push({ course_code, message: e?.message || String(e) });
      }
    }));

    if (i + CONCURRENCY < courses.length) await sleep(ROUND_GAP_MS);
  }

  const processed = attempted;
  const remaining = Math.max(staleCount - summary.updated - summary.no_wsq_support, 0);

  return res.status(200).json({
    summary, processed, remaining, total,
    stopped_early: stoppedEarly,
    errors: errors.slice(0, 20),
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
