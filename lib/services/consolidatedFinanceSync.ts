/**
 * Keeps `ssg_enrolments` — the table the Consolidated Finance Data page reads — in step
 * with every enrolment the LMS knows about.
 *
 * Learners reach a class through many paths (SSG → LMS syncs, Upsert from SSG, auto-enrol,
 * bulk create, the scheduler's `sync_ssg_enrolments` pull into `ssg_enrolment_record`, …)
 * and most of them only write `enrollment`. Rather than patch each writer, this module
 * reconciles from the two local sources of truth into `ssg_enrolments`, insert-only:
 *
 *   1. `enrollment.raw_data`               — full SSG record, refreshed by the LMS syncs
 *   2. `ssg_enrolment_record.raw_data`     — full SSG record from the scheduled SSG pull
 *   3. local `enrollment` columns          — synthesized fallback when no SSG payload exists
 *
 * Existing `ssg_enrolments` rows are never touched (ON CONFLICT DO NOTHING), so data that
 * came straight from SSG is never downgraded. Inserting rows here never enqueues invoices.
 */
import pool from '../db';
import { RUN_COURSE_CODE_SQL } from '../courseCode';
import { createSSGEnrolmentAPI } from '../ssg/api/enrolment-api';
import type { SSGCredentials } from '../ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { refreshGrantsForEnrolments } from './billingSync';
import { tryEnqueueInvoiceFromSsgRecord } from './invoiceJobs';

/** Only real SSG enrolment references (ENR-YYMM-NNNNNN) — keeps test/placeholder ids out. */
const SSG_ENROLMENT_REF_RE = `'^ENR-[0-9]{4}-[0-9]+$'`;

/** Safe text → date: accepts YYYY-MM-DD[...] or YYYYMMDD, anything else becomes NULL. */
const SAFE_DATE_SQL = (expr: string) => `(
  CASE
    WHEN ${expr} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN substr(${expr}, 1, 10)::date
    WHEN ${expr} ~ '^[0-9]{8}$' THEN to_date(${expr}, 'YYYYMMDD')
  END
)`;

const RECONCILE_SQL = `
WITH loc AS MATERIALIZED (
  SELECT DISTINCT ON (UPPER(TRIM(e.enrolment_id)))
         UPPER(TRIM(e.enrolment_id)) AS eid,
         e.enrolment_status, e.raw_data, e.course_sponsorship, e.enrolment_date,
         e.user_id, e.course_id, e.course_run_id, e.nric, e.email
    FROM enrollment e
   WHERE UPPER(TRIM(e.enrolment_id)) ~ ${SSG_ENROLMENT_REF_RE}
     AND ($1::text IS NULL OR e.course_run_id IN (SELECT id FROM course_run WHERE course_run_id = $1::text))
     AND NOT EXISTS (SELECT 1 FROM ssg_enrolments se WHERE se.enrolment_id = UPPER(TRIM(e.enrolment_id)))
   ORDER BY UPPER(TRIM(e.enrolment_id)), e.updated_at DESC NULLS LAST
),
ser AS MATERIALIZED (
  SELECT DISTINCT ON (UPPER(TRIM(r.enrolment_reference)))
         UPPER(TRIM(r.enrolment_reference)) AS eid,
         COALESCE(r.raw_data->'enrolment', r.raw_data) AS rec,
         r.status
    FROM ssg_enrolment_record r
   WHERE UPPER(TRIM(r.enrolment_reference)) ~ ${SSG_ENROLMENT_REF_RE}
     AND ($1::text IS NULL OR r.course_run_id = $1::text)
     AND NOT EXISTS (SELECT 1 FROM ssg_enrolments se WHERE se.enrolment_id = UPPER(TRIM(r.enrolment_reference)))
   ORDER BY UPPER(TRIM(r.enrolment_reference)), r.updated_at DESC NULLS LAST
),
missing AS (
  SELECT eid FROM loc UNION SELECT eid FROM ser
),
built AS (
  SELECT m.eid,
         COALESCE(NULLIF(TRIM(l.enrolment_status), ''), s.rec->>'status', s.status, 'Confirmed') AS status,
         CASE
           WHEN l.raw_data ? 'referenceNumber' AND l.raw_data ? 'course' THEN l.raw_data
           WHEN s.rec ? 'referenceNumber' AND s.rec ? 'course' THEN s.rec
           ELSE jsonb_build_object(
             'referenceNumber', m.eid,
             'trainee', jsonb_build_object(
               'fullName', u.full_name,
               'id', COALESCE(lp.nric, l.nric),
               'email', jsonb_build_object('full', COALESCE(u.email, l.email, '')),
               'sponsorshipType', CASE WHEN l.course_sponsorship::text ILIKE '%employer%' THEN 'EMPLOYER' ELSE 'INDIVIDUAL' END,
               'enrolmentDate', to_char(l.enrolment_date, 'YYYY-MM-DD')
             ),
             'course', jsonb_build_object(
               'title', c.title,
               'referenceNumber', ${RUN_COURSE_CODE_SQL},
               'run', jsonb_build_object(
                 'id', cr.course_run_id,
                 'startDate', to_char(cr.start_date, 'YYYY-MM-DD'),
                 'endDate', to_char(cr.end_date, 'YYYY-MM-DD')
               )
             ),
             'trainingPartner', jsonb_build_object('code', $2::text, 'uen', $3::text)
           )
         END AS rec
    FROM missing m
    LEFT JOIN loc l ON l.eid = m.eid
    LEFT JOIN ser s ON s.eid = m.eid
    LEFT JOIN app_user u ON u.id = l.user_id
    LEFT JOIN learner_profile lp ON lp.user_id = l.user_id
    LEFT JOIN course_run cr ON cr.id = l.course_run_id
    LEFT JOIN course c ON c.id = COALESCE(l.course_id, cr.course_id)
)
INSERT INTO ssg_enrolments (
  id, enrolment_id, trainee_name, trainee_nric,
  course_title, course_reference, course_run_id,
  training_partner_code, enrolment_status, sponsorship_type,
  enrolment_date, raw_data, created_date, imported_at
)
SELECT gen_random_uuid(), b.eid,
       b.rec->'trainee'->>'fullName',
       b.rec->'trainee'->>'id',
       b.rec->'course'->>'title',
       NULLIF(b.rec->'course'->>'referenceNumber', ''),
       NULLIF(b.rec->'course'->'run'->>'id', ''),
       COALESCE(b.rec->'trainingPartner'->>'code', $2::text),
       b.status,
       b.rec->'trainee'->>'sponsorshipType',
       ${SAFE_DATE_SQL(`(b.rec->'trainee'->>'enrolmentDate')`)},
       jsonb_set(b.rec, '{status}', to_jsonb(b.status)),
       NOW(), NOW()
  FROM built b
ON CONFLICT (enrolment_id) DO NOTHING
RETURNING enrolment_id`;

/**
 * Insert every enrolment known locally but missing from `ssg_enrolments`.
 * Pass a course run id (SSG/TPG run number) to scope it to one class.
 * Returns the enrolment ids that were added.
 */
export async function reconcileConsolidatedFinanceEnrolments(courseRunId?: string): Promise<string[]> {
  const tp = await getTrainingPartnerIdentifiers();
  const r = await pool.query(RECONCILE_SQL, [courseRunId?.trim() || null, tp.code || null, tp.uen || null]);
  return r.rows.map((row: { enrolment_id: string }) => row.enrolment_id);
}

const RECONCILE_THROTTLE_MS = 60_000;
const g = globalThis as unknown as { __financeReconcileAt?: number; __financeReconcileRunning?: Promise<void> };

/**
 * Throttled full reconcile for hot read paths (Consolidated Finance page load).
 * Runs at most once a minute per process; failures are logged, never thrown.
 */
export async function reconcileConsolidatedFinanceEnrolmentsThrottled(): Promise<void> {
  if (g.__financeReconcileRunning) return g.__financeReconcileRunning;
  if (g.__financeReconcileAt && Date.now() - g.__financeReconcileAt < RECONCILE_THROTTLE_MS) return;
  g.__financeReconcileAt = Date.now();
  g.__financeReconcileRunning = (async () => {
    try {
      const added = await reconcileConsolidatedFinanceEnrolments();
      if (added.length > 0) {
        console.log(`[consolidatedFinanceSync] added ${added.length} missing enrolment(s) to ssg_enrolments`);
      }
    } catch (e) {
      console.warn('[consolidatedFinanceSync] reconcile failed:', e);
    } finally {
      g.__financeReconcileRunning = undefined;
    }
  })();
  return g.__financeReconcileRunning;
}

// ── Per-run SSG pull (used by both "Import Course Run" buttons) ──────────────

const ENROL_PAGE_SIZE = 100;

async function fetchAllEnrolmentsForRun(
  api: ReturnType<typeof createSSGEnrolmentAPI>,
  tpUen: string,
  tpCode: string,
  runId: string
): Promise<any[]> {
  const all: any[] = [];
  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    const result = await api.searchEnrolment({
      parameters: { page: pageIndex, pageSize: ENROL_PAGE_SIZE },
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
    if (wrapped.length < ENROL_PAGE_SIZE) return all;
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

/** Upsert one SSG enrolment record (SSG is authoritative, so this overwrites). */
export async function upsertSsgEnrolmentStaging(record: any): Promise<void> {
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
      record?.referenceNumber ?? null,
      (trainee.fullName as string) || null,
      (trainee.id as string) || null,
      (course.title as string) || null,
      (course.referenceNumber as string) || null,
      (run.id as string) || null,
      (tp.code as string) || null,
      (record?.status as string) || null,
      (trainee.sponsorshipType as string) || null,
      (trainee.enrolmentDate as string) || null,
      JSON.stringify({ ...record, trainee: { ...trainee, email: { full: email } } }),
    ]
  );
}

export interface RunEnrolmentImportResult {
  enrolmentsFetched: number;
  enrolmentsUpserted: number;
  /** Local enrolments for this run that SSG search did not return but were added from LMS data. */
  enrolmentsAddedFromLocal: number;
  enrolmentSyncError: string | null;
}

/**
 * Pull this run's enrolments from SSG into `ssg_enrolments`, then add any local learners of
 * the run that are still missing, then refresh their grants.
 *
 * `enqueueInvoices` keeps the Finance import's existing auto-invoice behaviour; other
 * callers leave it off so importing a class never creates QuickBooks invoices.
 */
export async function importSsgEnrolmentsForRun(
  courseRunId: string,
  credentials: SSGCredentials,
  opts: { ssgApp?: string; enqueueInvoices?: boolean } = {}
): Promise<RunEnrolmentImportResult> {
  const out: RunEnrolmentImportResult = {
    enrolmentsFetched: 0,
    enrolmentsUpserted: 0,
    enrolmentsAddedFromLocal: 0,
    enrolmentSyncError: null,
  };
  const touched: string[] = [];

  try {
    const tp = await getTrainingPartnerIdentifiers();
    const tpUen = tp.uen || credentials.uen || '';
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
    const records = await fetchAllEnrolmentsForRun(api, tpUen, tp.code, courseRunId);
    out.enrolmentsFetched = records.length;

    for (const row of records) {
      const rec = row?.enrolment ?? row;
      const enrolId = rec?.referenceNumber ? String(rec.referenceNumber) : '';
      if (!enrolId) continue;
      try {
        await upsertSsgEnrolmentStaging(rec);
        out.enrolmentsUpserted++;
        touched.push(enrolId);
        if (opts.enqueueInvoices) {
          void tryEnqueueInvoiceFromSsgRecord(rec).catch((e: unknown) =>
            console.warn('[consolidatedFinanceSync] tryEnqueueInvoiceFromSsgRecord:', e)
          );
        }
      } catch (e) {
        console.warn('[consolidatedFinanceSync] upsert enrolment failed:', e);
      }
    }
  } catch (e) {
    out.enrolmentSyncError = e instanceof Error ? e.message : String(e);
    console.warn('[consolidatedFinanceSync] SSG enrolment pull failed:', out.enrolmentSyncError);
  }

  // Whatever SSG returned (or failed to), every learner the LMS has on this run belongs on the page.
  try {
    const added = await reconcileConsolidatedFinanceEnrolments(courseRunId);
    out.enrolmentsAddedFromLocal = added.length;
    touched.push(...added);
  } catch (e) {
    console.warn('[consolidatedFinanceSync] local reconcile failed:', e);
  }

  if (touched.length > 0) {
    try {
      await refreshGrantsForEnrolments(touched, opts.ssgApp);
    } catch (e) {
      console.warn('[consolidatedFinanceSync] refreshGrantsForEnrolments:', e);
    }
  }
  return out;
}
