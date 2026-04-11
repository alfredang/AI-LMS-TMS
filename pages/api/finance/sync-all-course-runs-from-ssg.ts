import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { refreshGrantsForEnrolments } from '../../../lib/services/billingSync';
import { tryEnqueueInvoiceFromSsgRecord } from '../../../lib/services/invoiceJobs';

const PAGE_SIZE = 100;
const MAX_RUNS_DEFAULT = 80;
// Keep calls reasonably paced; too aggressive can trigger throttling.
const RATE_LIMIT_MS = 700;
/** Delay between SSG view-enrolment calls when skipping heavy run search (faster UI refresh). */
const VIEW_ENROLMENT_GAP_MS = 400;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toIsoDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function withinRange(dateIso: string, fromIso: string, toIso: string): boolean {
  return dateIso >= fromIso && dateIso <= toIso;
}

async function getCourseRunIdsToSync(fromIso: string, toIso: string): Promise<string[]> {
  // Use local staging data to determine which course runs exist in this window,
  // then refresh those runs directly from SSG.
  const r = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(se.course_run_id, ''), se.raw_data->'course'->'run'->>'id') AS run_id
     FROM ssg_enrolments se
     WHERE (
       CASE
         WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{8}$' THEN
           substr((se.raw_data->'course'->'run'->>'startDate'), 1, 4) || '-' ||
           substr((se.raw_data->'course'->'run'->>'startDate'), 5, 2) || '-' ||
           substr((se.raw_data->'course'->'run'->>'startDate'), 7, 2)
         WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
           substr((se.raw_data->'course'->'run'->>'startDate'), 7, 4) || '-' ||
           substr((se.raw_data->'course'->'run'->>'startDate'), 4, 2) || '-' ||
           substr((se.raw_data->'course'->'run'->>'startDate'), 1, 2)
         ELSE (se.raw_data->'course'->'run'->>'startDate')
       END
     ) BETWEEN $1 AND $2
       AND COALESCE(NULLIF(se.course_run_id, ''), se.raw_data->'course'->'run'->>'id') IS NOT NULL
     ORDER BY run_id`,
    [fromIso, toIso]
  );
  return r.rows.map((row: any) => String(row.run_id)).filter(Boolean);
}

async function fetchAllEnrolmentsForRun(
  api: ReturnType<typeof createSSGEnrolmentAPI>,
  tpUen: string,
  tpCode: string,
  runId: string
): Promise<any[]> {
  const all: any[] = [];
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const result = await api.searchEnrolment({
      // SSG enrolment search expects `parameters` paging keys in our codebase.
      parameters: { page: pageIndex, pageSize: PAGE_SIZE },
      enrolment: {
        course: { run: { id: runId } },
        trainingPartner: { uen: tpUen, code: tpCode },
      },
    } as any);

    if (result.error) {
      const code = String(result.status ?? 0);
      if (code === '404') return all;
      throw new Error(`SSG enrolment search failed for run ${runId}: ${code} ${result.error.message ?? ''}`.trim());
    }

    const wrapped: any[] = Array.isArray(result.data) ? result.data : [];
    if (wrapped.length === 0) return all;
    all.push(...wrapped);
    if (wrapped.length < PAGE_SIZE) return all;
    // A small delay only when paging within the same run.
    await sleep(250);
  }
  return all;
}

async function upsertSsgEnrolmentStaging(record: any): Promise<void> {
  const trainee = (record?.trainee ?? {}) as Record<string, unknown>;
  const course = (record?.course ?? {}) as Record<string, unknown>;
  const run = (course?.run ?? {}) as Record<string, unknown>;
  const tp = (record?.trainingPartner ?? {}) as Record<string, unknown>;
  const email = (trainee.email as Record<string, unknown>)?.full ?? null;

  await pool.query(
    `INSERT INTO ssg_enrolments (
       id, enrolment_id, trainee_name, trainee_nric,
       course_title, course_reference, course_run_id,
       training_partner_code, enrolment_status, sponsorship_type,
       enrolment_date, raw_data, created_date, imported_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::timestamptz, $11, NOW(), NOW()
     )
     ON CONFLICT (enrolment_id) DO UPDATE SET
       trainee_name = EXCLUDED.trainee_name,
       trainee_nric = EXCLUDED.trainee_nric,
       course_title = EXCLUDED.course_title,
       course_reference = EXCLUDED.course_reference,
       course_run_id = EXCLUDED.course_run_id,
       enrolment_status = EXCLUDED.enrolment_status,
       sponsorship_type = EXCLUDED.sponsorship_type,
       enrolment_date = EXCLUDED.enrolment_date,
       raw_data = EXCLUDED.raw_data,
       imported_at = NOW()`,
    [
      record?.referenceNumber ?? null, // enrolment_id
      (trainee.fullName as string) || null,
      (trainee.id as string) || null,
      (course.title as string) || null,
      (course.referenceNumber as string) || null,
      (run.id as string) || null, // course_run_id
      (tp.code as string) || null,
      (record?.status as string) || null,
      (trainee.sponsorshipType as string) || null,
      (trainee.enrolmentDate as string) || null,
      JSON.stringify({ ...record, trainee: { ...trainee, email: { full: email } } }),
    ]
  );
}

async function backfillClaimsEnrollmentId(): Promise<{ updated: number }> {
  const r = await pool.query(
    `UPDATE ssg_claims sc
     SET enrollment_id = g.enrollment_id
     FROM ssg_grants g
     WHERE (sc.enrollment_id IS NULL OR sc.enrollment_id = '')
       AND sc.grant_id IS NOT NULL
       AND sc.grant_id = g.grant_id
       AND g.enrollment_id IS NOT NULL
     RETURNING sc.claim_id`
  );
  return { updated: r.rowCount ?? 0 };
}

/**
 * POST /api/finance/sync-all-course-runs-from-ssg
 * Body: { from?, to?, maxRuns?, enrolmentIds?, includeRunSearch?: boolean }
 *
 * When `enrolmentIds` is non-empty and `includeRunSearch` is not true, the heavy per–course-run
 * SSG **search** pass is skipped (saves minutes and avoids SSG 500s on search). Only view-by-id + grants run.
 * Set `includeRunSearch: true` to also scan every course run in the date window (slow).
 *
 * By default, recently updated rows in `enrollment` (last 14 days) are merged into the view list so
 * **new** ENR- IDs created locally appear in the refresh even if they are not on the current grid page.
 *
 * When `enrolmentIds` is provided (e.g. current table page), each id is refreshed from SSG via
 * view-enrolment and upserted so the consolidated grid shows latest status without relying only on run search.
 *
 * Pulls enrolments from SSG (paged), filters by course run startDate within [from,to],
 * upserts matching to ssg_enrolments, refreshes ssg_grants for those enrolments,
 * then backfills ssg_claims.enrollment_id via grant_id -> ssg_grants.enrollment_id.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const todayIso = new Date().toISOString().slice(0, 10);
  const rawFromIso = (typeof body.from === 'string' && body.from.trim())
    ? body.from.trim()
    : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const rawToIso = (typeof body.to === 'string' && body.to.trim()) ? body.to.trim() : todayIso;
  const fromIso = rawFromIso <= rawToIso ? rawFromIso : rawToIso;
  const toIso = rawFromIso <= rawToIso ? rawToIso : rawFromIso;
  const maxRuns = Math.min(Math.max(Number(body.maxRuns || 0) || MAX_RUNS_DEFAULT, 1), 600);
  const idsFromClient = Array.isArray(body.enrolmentIds)
    ? (body.enrolmentIds as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];

  /** Full run search: only when no visible IDs to refresh, or caller explicitly asks. */
  const includeRunSearch = body.includeRunSearch === true || idsFromClient.length === 0;

  const ssgApp = (req.headers['x-ssg-app'] as string | undefined)?.trim() || undefined;

  const startedAt = Date.now();
  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    // Prefer platform TP identifiers (matches other working sync flows)
    const tpUen = tp.uen || credentials.uen;
    const tpCode = tp.code;
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    // Merge recent local `enrollment` ENR ids so new / re-enrolled rows get SSG view even when not on the current page.
    let viewEnrolmentIds = [...idsFromClient];
    const mergeRecentLocal = body.mergeRecentLocalEnrolments !== false;
    if (mergeRecentLocal) {
      const recent = await pool.query(
        `SELECT TRIM(e.enrolment_id)::text AS eid
         FROM enrollment e
         WHERE e.enrolment_id IS NOT NULL
           AND TRIM(COALESCE(e.enrolment_id, '')) <> ''
           AND e.updated_at > NOW() - INTERVAL '14 days'
         GROUP BY TRIM(e.enrolment_id)
         ORDER BY MAX(e.updated_at) DESC
         LIMIT 50`
      );
      const seen = new Set(viewEnrolmentIds.map((id) => id.toLowerCase()));
      for (const row of recent.rows) {
        const id = String((row as { eid: string }).eid || '').trim();
        if (!id) continue;
        const k = id.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          viewEnrolmentIds.push(id);
        }
      }
    }

    const syncedEnrolmentIds: string[] = [];
    let runsFetched = 0;
    let totalSeen = 0;
    let totalMatched = 0;
    let totalUpserted = 0;
    const errors: Array<{ runId: string; error: string }> = [];

    let runIds: string[] = [];
    let limitedRunIds: string[] = [];

    if (includeRunSearch) {
      runIds = await getCourseRunIdsToSync(fromIso, toIso);
      limitedRunIds = runIds.slice(0, maxRuns);

      for (const runId of limitedRunIds) {
        runsFetched++;
        try {
          const wrapped = await fetchAllEnrolmentsForRun(api, tpUen, tpCode, runId);
          totalSeen += wrapped.length;

          for (const row of wrapped) {
            const rec = row?.enrolment ?? row;
            const enrolId = rec?.referenceNumber ? String(rec.referenceNumber) : '';
            if (!enrolId) continue;

            const runStartIso = toIsoDate(rec?.course?.run?.startDate);
            if (!runStartIso) continue;
            if (!withinRange(runStartIso, fromIso, toIso)) continue;

            totalMatched++;
            try {
              await upsertSsgEnrolmentStaging(rec);
              totalUpserted++;
              syncedEnrolmentIds.push(enrolId);
              void tryEnqueueInvoiceFromSsgRecord(rec).catch((e: unknown) =>
                console.warn('[sync-all-course-runs-from-ssg] tryEnqueueInvoiceFromSsgRecord:', e)
              );
            } catch {
              // keep going
            }
          }
        } catch (e) {
          errors.push({ runId, error: e instanceof Error ? e.message : String(e) });
        }

        await sleep(RATE_LIMIT_MS);
      }
    }

    const viewGapMs = includeRunSearch ? RATE_LIMIT_MS : VIEW_ENROLMENT_GAP_MS;

    let refreshedById = 0;
    const requestedId = new Set<string>();
    for (const enrolmentId of viewEnrolmentIds) {
      if (requestedId.has(enrolmentId)) continue;
      requestedId.add(enrolmentId);
      try {
        const viewResult = await api.viewEnrolment(enrolmentId);
        if (viewResult.error) {
          errors.push({ runId: enrolmentId, error: `view: ${(viewResult as { error?: { message?: string } }).error?.message ?? 'failed'}` });
          await sleep(viewGapMs);
          continue;
        }
        const raw: any = viewResult.data;
        const rec = raw?.enrolment ?? raw;
        if (!rec?.referenceNumber) {
          await sleep(viewGapMs);
          continue;
        }
        await upsertSsgEnrolmentStaging(rec);
        refreshedById++;
        totalUpserted++;
        const ref = String(rec.referenceNumber);
        syncedEnrolmentIds.push(ref);
        void tryEnqueueInvoiceFromSsgRecord(rec).catch((e: unknown) =>
          console.warn('[sync-all-course-runs-from-ssg] tryEnqueueInvoiceFromSsgRecord:', e)
        );
      } catch (e) {
        errors.push({ runId: enrolmentId, error: e instanceof Error ? e.message : String(e) });
      }
      await sleep(viewGapMs);
    }

    const uniqueEnrolmentIds = Array.from(new Set(syncedEnrolmentIds));
    const grantResults = uniqueEnrolmentIds.length > 0
      ? await refreshGrantsForEnrolments(uniqueEnrolmentIds, ssgApp)
      : [];

    const grantsOk = grantResults.filter((r) => r.success).length;
    const grantsFailed = grantResults.length - grantsOk;

    try {
      const { runPendingInvoiceJobs } = await import('@/lib/services/invoiceJobsRunner');
      // Runner caps at 10 jobs per call — loop until queue is drained (typical page size ≤ 20).
      for (let wave = 0; wave < 15; wave++) {
        const r = await runPendingInvoiceJobs(10);
        if (r.picked === 0) break;
      }
    } catch (e: unknown) {
      console.warn('[sync-all-course-runs-from-ssg] runPendingInvoiceJobs:', e instanceof Error ? e.message : e);
    }

    const claimBackfill = await backfillClaimsEnrollmentId();

    return res.status(200).json({
      success: true,
      syncMode: includeRunSearch ? 'full' : 'viewOnly',
      includeRunSearch,
      idsFromClient: idsFromClient.length,
      viewEnrolmentIdsCount: viewEnrolmentIds.length,
      extraLocalEnrolmentIdsMerged: Math.max(0, viewEnrolmentIds.length - idsFromClient.length),
      window: { from: fromIso, to: toIso },
      runsConsidered: runIds.length,
      runsFetched,
      sampleRunIds: limitedRunIds.slice(0, 10),
      totals: {
        seenFromSsg: totalSeen,
        matchedByRunStartDate: totalMatched,
        upsertedEnrolments: totalUpserted,
        refreshedByEnrolmentId: refreshedById,
        enrolmentsForGrantRefresh: uniqueEnrolmentIds.length,
        grantsOk,
        grantsFailed,
        claimsEnrollmentIdBackfilled: claimBackfill.updated,
      },
      errors,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : 'Internal server error',
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  }
}

