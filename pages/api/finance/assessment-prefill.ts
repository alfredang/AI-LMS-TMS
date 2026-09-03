import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { upsertSsgEnrolmentStaging, toIsoDate } from './sync-all-course-runs-from-ssg';

interface PrefillRow {
  enrolment_id: string;
  trainee_name: string | null;
  trainee_nric: string | null;
  course_reference: string | null;
  course_title: string | null;
  enrolment_status: string | null;
  course_run_number: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Resolves the fields the Bulk Update Assessment flow needs (including the FULL trainee
 * NRIC/FIN) for a specific, caller-chosen set of enrolment IDs selected on the Consolidated
 * Finance Data page.
 *
 * Deliberately separate from /api/finance/all-course-runs, which masks trainee_nric in SQL
 * before it ever reaches the browser — that masking must stay in place for the general grid.
 * This endpoint exists ONLY to feed the assessment-update preview for rows the caller already
 * selected, so returning the unmasked NRIC here (needed for SSG's traineeIdType detection) does
 * not widen exposure beyond what the paste-from-Google-Sheet flow already showed on screen.
 */
/** Normalizes an SSG run date (YYYYMMDD or DD/MM/YYYY) to YYYY-MM-DD text, matching all-course-runs.ts. */
const normDateSql = (jsonPathExpr: string) => `(
  CASE
    WHEN (${jsonPathExpr}) ~ '^[0-9]{8}$' THEN
      substr((${jsonPathExpr}), 1, 4) || '-' || substr((${jsonPathExpr}), 5, 2) || '-' || substr((${jsonPathExpr}), 7, 2)
    WHEN (${jsonPathExpr}) ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
      substr((${jsonPathExpr}), 7, 4) || '-' || substr((${jsonPathExpr}), 4, 2) || '-' || substr((${jsonPathExpr}), 1, 2)
    ELSE NULLIF(trim(${jsonPathExpr}), '')
  END
)`;

/**
 * Some ssg_enrolments rows were created by the local-DB backfill path (invoice_jobs done, no SSG
 * record ever synced) rather than a real SSG sync, and can end up with a blank trainee_nric or
 * course_run_number that's since gone stale (e.g. the learner's NRIC was added to their profile
 * AFTER the backfill ran). Rather than surface that gap to the admin, self-heal it here with one
 * live SSG view-enrolment call per affected row — the same call "Refresh from SSG" makes — and
 * persist the result so it's fixed for good, not just for this one preview.
 */
async function refreshFromSsg(enrolmentIds: string[], ssgApp?: string): Promise<Map<string, any>> {
  const refreshed = new Map<string, any>();
  if (enrolmentIds.length === 0) return refreshed;
  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
    if (!credentials) return refreshed;
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    for (let i = 0; i < enrolmentIds.length; i++) {
      const id = enrolmentIds[i];
      try {
        const viewResult = await api.viewEnrolment(id);
        if (!viewResult.error) {
          const raw: any = viewResult.data;
          const rec = raw?.enrolment ?? raw;
          if (rec?.referenceNumber) {
            await upsertSsgEnrolmentStaging(rec);
            refreshed.set(id, rec);
          }
        }
      } catch (e) {
        console.warn('[finance/assessment-prefill] live SSG refresh failed for', id, e);
      }
      if (i < enrolmentIds.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    console.warn('[finance/assessment-prefill] SSG credentials unavailable, skipping self-heal:', e);
  }
  return refreshed;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const enrolmentIds = Array.isArray(req.body?.enrolmentIds)
    ? req.body.enrolmentIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'enrolmentIds array is required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         se.enrolment_id,
         se.trainee_name,
         se.trainee_nric,
         se.course_reference,
         se.course_title,
         se.enrolment_status,
         se.raw_data->'course'->'run'->>'id' AS course_run_number,
         ${normDateSql(`se.raw_data->'course'->'run'->>'startDate'`)} AS start_date,
         ${normDateSql(`se.raw_data->'course'->'run'->>'endDate'`)} AS end_date
       FROM ssg_enrolments se
       WHERE se.enrolment_id = ANY($1::text[])`,
      [enrolmentIds]
    );
    const rows = result.rows as PrefillRow[];

    const needsRefresh = rows
      .filter((r) => !r.trainee_nric?.trim() || !r.course_run_number?.trim())
      .map((r) => r.enrolment_id);

    if (needsRefresh.length > 0) {
      const ssgApp = (req.headers['x-ssg-app'] as string | undefined)?.trim() || undefined;
      const refreshedById = await refreshFromSsg(needsRefresh, ssgApp);
      for (const row of rows) {
        const rec = refreshedById.get(row.enrolment_id);
        if (!rec) continue;
        const trainee = rec.trainee || {};
        const course = rec.course || {};
        const run = course.run || {};
        row.trainee_nric = trainee.id || row.trainee_nric;
        row.trainee_name = trainee.fullName || row.trainee_name;
        row.course_run_number = run.id || row.course_run_number;
        row.course_reference = course.referenceNumber || row.course_reference;
        row.course_title = course.title || row.course_title;
        row.start_date = toIsoDate(run.startDate) || row.start_date;
        row.end_date = toIsoDate(run.endDate) || row.end_date;
      }
    }

    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.error('[ERROR] [finance/assessment-prefill] Failed to fetch:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
