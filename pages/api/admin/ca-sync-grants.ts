import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { upsertSsgGrant } from '../../../lib/services/billingSync';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import crypto from 'crypto';

const IV = Buffer.from('SSGAPIInitVector', 'utf8');

/**
 * POST /api/admin/ca-sync-grants
 *
 * For every distinct course_run_id in company_application (current/future
 * courses only), searches SSG grants by courseRunId and upserts results into
 * ssg_grants. This is the catch-up mechanism for grants that stakeholders
 * apply manually in the SSG portal AFTER the Excel upload — SSG does not
 * expose a grant application API, so we sweep periodically (or on-demand
 * via the View Company Application "Sync Grants" button) to pull them in.
 *
 * Mirrors /api/admin/da-sync-grants — same payload shape, just scoped to
 * the company_application table instead of da_application.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const ssgApp = (req.headers['x-ssg-app'] as string | undefined)?.trim() || undefined;
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const tp = await getTrainingPartnerIdentifiers();
    const uen = credentials.uen || tp.uen;

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    // Include course runs that are current/future OR ended within the last
    // 60 days. Previously this hard-filtered to start_date >= today, which
    // silently excluded any course whose grants hadn't been pulled in by the
    // time the course began — a real failure mode we found in production
    // (grants sit in SSG but never make it into ssg_grants, because the
    // sweep skips the run forever once it's started).
    //
    // course_run.end_date is the source of truth; for CA rows where the run
    // hasn't been resolved yet (no JOIN match) we approximate with
    // course_start_date + 7 days, which covers ~95% of WSQ courses.
    const runRes = await pool.query(
      `SELECT DISTINCT ca.course_run_id
         FROM public.company_application ca
         LEFT JOIN public.course_run cr ON ca.course_run_id = cr.course_run_id
        WHERE ca.course_run_id IS NOT NULL
          AND ca.course_run_id <> ''
          AND COALESCE(
                cr.end_date,
                ca.course_start_date::date + INTERVAL '7 days'
              ) >= CURRENT_DATE - INTERVAL '60 days'`
    );
    const courseRunIds: string[] = runRes.rows.map((r: any) => String(r.course_run_id));

    interface RunResult {
      courseRunId: string;
      grantsUpserted: number;
      grantsFailed: number;
      error?: string;
    }
    const runs: RunResult[] = [];
    let totalGrants = 0;
    let runsSucceeded = 0;
    let runsFailed = 0;
    const errors: string[] = [];

    for (const courseRunId of courseRunIds) {
      const runResult: RunResult = { courseRunId, grantsUpserted: 0, grantsFailed: 0 };
      try {
        const ssgPayload = {
          grants: {
            course: { run: { id: courseRunId } },
            trainingPartner: { uen, code: tp.code },
          },
          parameters: { page: 0, pageSize: 100 },
        };

        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
        let encrypted = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const builder = new HTTPRequestBuilder()
          .withEndpoint(ssgBaseUrl, '/tpg/grants/search')
          .withMethod(HttpMethod.POST)
          .withBody(encrypted);

        if (credentials.certificateContent && credentials.privateKeyContent) {
          builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
        }

        const httpResponse = await httpClient.request(builder.build());

        if (httpResponse.status !== 200) {
          const msg = `SSG returned ${httpResponse.status}`;
          runResult.error = msg;
          errors.push(`Run ${courseRunId}: ${msg}`);
          runs.push(runResult);
          runsFailed++;
          continue;
        }

        const rawBody = typeof httpResponse.data === 'string'
          ? httpResponse.data
          : JSON.stringify(httpResponse.data);

        const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
        let decrypted = decipher.update(rawBody, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);

        const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
        if (hasError) {
          const msg = parsed.error.message || parsed.error.code;
          runResult.error = msg;
          errors.push(`Run ${courseRunId}: ${msg}`);
          runs.push(runResult);
          runsFailed++;
          continue;
        }

        const grants: Record<string, unknown>[] = Array.isArray(parsed?.data) ? parsed.data : [];
        for (const grant of grants) {
          try {
            await upsertSsgGrant(grant);
            runResult.grantsUpserted++;
            totalGrants++;
          } catch (e) {
            console.warn(`[ca-sync-grants] Failed to upsert grant for run ${courseRunId}:`, e);
            runResult.grantsFailed++;
          }
        }

        // A run with any upsert failures is not fully succeeded — surface it
        // so the admin knows to investigate even if some grants came through.
        if (runResult.grantsFailed > 0) {
          runResult.error = `${runResult.grantsFailed} of ${grants.length} grant upserts failed`;
          errors.push(`Run ${courseRunId}: ${runResult.error}`);
          runsFailed++;
        } else {
          runsSucceeded++;
        }
        runs.push(runResult);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        runResult.error = msg;
        errors.push(`Run ${courseRunId}: ${msg}`);
        runs.push(runResult);
        runsFailed++;
      }
    }

    // Backfill ca.grant_id from ssg_grants so the View page checkbox + the
    // invoice-step grant guard see the fresh data immediately. Picks the
    // best grant per enrolment (approved if positive, else estimated,
    // status not Cancelled). Mirrors sweepGrantsByCourseRun in
    // lib/autoEnrolCompanyApplications.ts — see that file's comment for
    // why COALESCE(approved, estimated, 0) is wrong here (approved=0
    // wins over a positive estimated).
    await pool.query(
      `UPDATE public.company_application ca
          SET grant_id = sg.grant_id,
              grant_amount = sg.amount,
              grant_application_nos = COALESCE(ca.grant_application_nos, sg.grant_id),
              updated_at = now()
        FROM (
          SELECT DISTINCT ON (LOWER(TRIM(enrollment_id)))
                 LOWER(TRIM(enrollment_id)) AS enrolment_key,
                 grant_id,
                 (CASE
                    WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                    ELSE COALESCE(estimated_grant_amount, 0)
                  END) AS amount
            FROM public.ssg_grants
           WHERE COALESCE(status, '') <> 'Cancelled'
             AND (
                   COALESCE(approved_grant_amount, 0) > 0
                OR COALESCE(estimated_grant_amount, 0) > 0
             )
           ORDER BY LOWER(TRIM(enrollment_id)),
                    (CASE
                       WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                       ELSE COALESCE(estimated_grant_amount, 0)
                     END) DESC NULLS LAST
        ) sg
       WHERE LOWER(TRIM(ca.enrolment_id)) = sg.enrolment_key
         AND (COALESCE(ca.grant_id, '') = '' OR ca.grant_id <> sg.grant_id)`
    );

    // Reconcile auto_enrol_status for rows whose auto-pipeline poll was
    // interrupted by a server restart. Same CASE the bulk runner applies at
    // the end of bulkProcessCompanyApplications — rows stay 'pending' until
    // the final flip, so a manual Sync Grants needs to perform the same
    // reconciliation or the View page will show "Pending" forever even though
    // the work is done.
    await pool.query(
      `UPDATE public.company_application
          SET auto_enrol_status = CASE
                WHEN enrolment_id IS NULL THEN 'failed'
                WHEN COALESCE(grant_id, '') <> '' OR COALESCE(grant_ineligible, false) = true THEN 'grant_found'
                ELSE 'enroled'
              END,
              updated_at = now()
        WHERE auto_enrol_status = 'pending'`
    );

    return res.status(200).json({
      success: true,
      runsProcessed: runs.length,
      runsSucceeded,
      runsFailed,
      totalGrantsUpserted: totalGrants,
      runs,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('❌ ca-sync-grants error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
