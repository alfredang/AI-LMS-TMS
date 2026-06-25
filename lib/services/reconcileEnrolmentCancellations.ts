/**
 * Reconcile TPG enrolment cancellations back into the local DB.
 *
 * Why this exists
 * ───────────────
 * When a learner cancels (or is withdrawn) on TPGateway, nothing updates the
 * local `enrollment.enrolment_status` — it stays `Confirmed`. The existing
 * `sync-ssg-enrolments` job cannot fix this because it searches SSG by
 * *enrolment creation date* (last 7 days) and is INSERT-only, so a later
 * cancellation of an older enrolment is never re-fetched or updated.
 *
 * This left local enrolment status unreliable as a guard and caused a real
 * incident (a cancelled learner still got an assessment pushed to TPG / an SOA).
 *
 * What this does
 * ──────────────
 * For each active local enrolment on a course run in a relevant window
 * (recently ended or near-future), it asks TPG for the current enrolment status
 * via `viewEnrolment` and, if TPG reports it cancelled/withdrawn, writes that
 * back to the local `enrollment` row (and the `ssg_enrolment_record` mirror).
 *
 * Conservative by design: it only ever propagates *cancellations*. It never
 * flips a cancelled local row back to active, so it won't fight other flows.
 */

import pool from '../db';
import { createSSGEnrolmentAPI } from '../ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../ssg/services/credentials-service';
import { isCancelledEnrolmentStatus } from './enrolmentEligibility';

const RATE_LIMIT_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ReconcileOptions {
  /** How far back (by course-run end date) to look. Default 30 days. */
  pastDays?: number;
  /** How far forward (by course-run start date) to look. Default 60 days. */
  futureDays?: number;
  /** Hard cap on how many enrolments to check in one run (SSG call budget). Default 500. */
  maxChecks?: number;
  /** SSG app key (multi-app tenants). Defaults to the primary app. */
  ssgApp?: string;
}

export interface ReconcileResult {
  success: boolean;
  candidates: number;
  checked: number;
  updated: number;
  unchanged: number;
  errors: number;
  message?: string;
  updatedEnrolments: Array<{ enrolmentId: string; from: string | null; to: string }>;
}

const g = globalThis as unknown as { __reconcileEnrolmentCancellationsRunning?: boolean };
if (g.__reconcileEnrolmentCancellationsRunning === undefined) g.__reconcileEnrolmentCancellationsRunning = false;

export async function reconcileEnrolmentCancellations(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
  if (g.__reconcileEnrolmentCancellationsRunning) {
    console.warn('[reconcile-enrolment-cancellations] Another run is already in progress — skipping');
    return { success: false, candidates: 0, checked: 0, updated: 0, unchanged: 0, errors: 0, message: 'Already running', updatedEnrolments: [] };
  }
  g.__reconcileEnrolmentCancellationsRunning = true;
  try {
    return await _run(opts);
  } finally {
    g.__reconcileEnrolmentCancellationsRunning = false;
  }
}

async function _run(opts: ReconcileOptions): Promise<ReconcileResult> {
  const pastDays = opts.pastDays ?? 30;
  const futureDays = opts.futureDays ?? 60;
  const maxChecks = opts.maxChecks ?? 500;

  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, opts.ssgApp);
  if (!credentials) {
    return { success: false, candidates: 0, checked: 0, updated: 0, unchanged: 0, errors: 0, message: 'SSG credentials not found', updatedEnrolments: [] };
  }

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

  // Active local enrolments on runs in the window, with a known SSG reference.
  const candidatesRes = await pool.query<{ id: string; enrolment_id: string; enrolment_status: string | null }>(
    `SELECT e.id, e.enrolment_id, e.enrolment_status
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
      WHERE e.enrolment_id IS NOT NULL AND e.enrolment_id <> ''
        AND COALESCE(LOWER(e.enrolment_status), '') NOT IN ('cancelled', 'withdrawn', 'admin removed')
        AND cr.end_date   >= (NOW() AT TIME ZONE 'Asia/Singapore')::date - ($1 || ' days')::interval
        AND cr.start_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($2 || ' days')::interval
      ORDER BY cr.start_date DESC
      LIMIT $3`,
    [String(pastDays), String(futureDays), maxChecks]
  );

  const candidates = candidatesRes.rows;
  console.log(`[reconcile-enrolment-cancellations] ${candidates.length} active enrolment(s) to check (window -${pastDays}d..+${futureDays}d, cap ${maxChecks})`);

  let checked = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const updatedEnrolments: ReconcileResult['updatedEnrolments'] = [];

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    if (i > 0) await sleep(RATE_LIMIT_MS);

    try {
      const result = await api.viewEnrolment(row.enrolment_id);
      checked++;

      if (result.error || !result.data) {
        // Not necessarily a real error (e.g. enrolment not visible) — count and move on.
        errors++;
        continue;
      }

      const rec = (result.data as any)?.enrolment ?? result.data;
      const tpgStatus: string | null = rec?.status ?? null;

      if (isCancelledEnrolmentStatus(tpgStatus)) {
        // Propagate the cancellation locally. Use the TPG-provided value verbatim
        // (e.g. 'Cancelled' / 'Withdrawn') to stay consistent with TPG.
        const newStatus = String(tpgStatus);
        await pool.query(
          `UPDATE enrollment SET enrolment_status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, row.id]
        );
        // Keep the SSG mirror table in sync too (best-effort).
        await pool
          .query(
            `UPDATE ssg_enrolment_record SET status = $1, updated_at = NOW() WHERE enrolment_reference = $2`,
            [newStatus, row.enrolment_id]
          )
          .catch(() => {});

        updated++;
        updatedEnrolments.push({ enrolmentId: row.enrolment_id, from: row.enrolment_status, to: newStatus });
        console.log(`[reconcile-enrolment-cancellations] ${row.enrolment_id}: ${row.enrolment_status ?? 'null'} → ${newStatus}`);
      } else {
        unchanged++;
      }
    } catch (err) {
      errors++;
      console.error(`[reconcile-enrolment-cancellations] Error for ${row.enrolment_id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[reconcile-enrolment-cancellations] Done: checked=${checked}, updated=${updated}, unchanged=${unchanged}, errors=${errors}`);
  return { success: true, candidates: candidates.length, checked, updated, unchanged, errors, updatedEnrolments };
}
