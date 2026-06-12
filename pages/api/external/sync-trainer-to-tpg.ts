import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { TrainerType } from '../../../lib/ssg/models/course-runs';
import type { RunTrainerEditInfo } from '../../../lib/ssg/models/edit-delete-course-run';


/**
 * External API — Sync Trainer (Local) to TPG/SSG (sanity check)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily after "Fetch TGS Enrolments & Assign Trainers"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Real-time TPG push happens at trainer-invitation accept-time
 * (lib/ssg/pushTrainerToTpgForRun.ts), so this scheduled run is a SANITY CHECK
 * that only acts on two cases:
 *   1. MISSING TPG — local trainer assigned but tpg_assigned_trainer_name is
 *      empty (e.g. admin assigned via UI without invitation, or the accept-time
 *      push failed transiently).
 *   2. MISMATCHED TPG — TPG trainer name differs from the current local trainer
 *      (e.g. trainer was reassigned locally and TPG still has the old name).
 *
 * Runs where TPG already matches local are filtered out at the SQL level — no
 * SSG API call is made for already-synced runs, saving rate-limit budget.
 *
 * FLOW (per matching run):
 *   1. Resolve trainer NRIC via trainer_id → email → name fallback.
 *   2. Call SSG Edit Course Run with linkCourseRunTrainer payload.
 *   3. On success, write tpg_assigned_trainer_name/email and tpg_sync_status.
 *   4. Log each attempt with NRIC presence and SSG response.
 *
 * POST /api/external/sync-trainer-to-tpg
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_MS = 2000;

// ── Ensure log table + tpg_sync_status column ────────────────────────────────

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_trainer_tpg_log (
      id                SERIAL PRIMARY KEY,
      run_id            TEXT NOT NULL,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      course_run_id     TEXT,
      course_run_uuid   TEXT,
      course_code       TEXT,
      course_ref_number TEXT,
      trainer_name      TEXT,
      trainer_email     TEXT,
      nric_present      BOOLEAN NOT NULL DEFAULT FALSE,
      nric_masked       TEXT,
      ssg_status        INTEGER,
      ssg_response      TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      error_message     TEXT
    )
  `);
  // Column on course_run to surface sync failure reason in the UI
  // Values: null (not attempted), 'synced', 'no_nric', 'no_tpg_profile', 'error:<msg>'
  await pool.query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_sync_status TEXT`);
}

// ── Mask NRIC for logging (show first + last char only) ───────────────────────

function maskNric(nric: string): string {
  if (!nric || nric.length < 3) return '***';
  return `${nric[0]}${'*'.repeat(nric.length - 2)}${nric[nric.length - 1]}`;
}

// ── Parse SSG error into a tpg_sync_status value ─────────────────────────────
// Exported so run-bulk-tpg-assign.ts can reuse the same classification.

export function classifySsgError(ssgErrorMsg: string, ssgStatus?: number): string {
  const msg = (ssgErrorMsg || '').toLowerCase();

  if (msg.includes('existing_trainer_notfound'))                                return 'no_tpg_profile';
  if (msg.includes('field_error') && msg.includes('trainer'))                   return 'no_tpg_profile';
  if (msg.includes('viewcourserun failed'))                                     return 'run_not_found_ssg';
  if (msg.includes('registrationopeningdate') || (msg.includes('registration') && msg.includes('past')))
                                                                                return 'reg_date_passed';
  if (msg.includes('cancelled'))                                                return 'course_cancelled';
  if (msg.includes('expired') || msg.includes('completed'))                     return 'course_expired';
  if (msg.includes('not editable') || msg.includes('cannot edit') || msg.includes('noteditable'))
                                                                                return 'not_editable';
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound'))
                                                                                return 'ssg_timeout';
  if (msg.includes('unauthorized') || msg.includes('403') || ssgStatus === 401 || ssgStatus === 403)
                                                                                return 'ssg_auth_error';
  if (msg.includes('decrypt'))                                                  return 'ssg_decrypt_error';
  if (msg.includes('invalid input') || msg.includes('invalid parameter'))       return 'no_tpg_profile';
  if (msg.includes('404') || msg.includes('not found') || msg.includes('page not found'))
                                                                                return 'run_not_found_ssg';

  return `error:${ssgErrorMsg.slice(0, 100)}`;
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __syncTrainerTpgRunning?: boolean };
if (g.__syncTrainerTpgRunning === undefined) g.__syncTrainerTpgRunning = false;

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runSyncTrainerToTpg() {
  if (g.__syncTrainerTpgRunning) {
    console.warn('[sync-trainer-to-tpg] Another run is already in progress — skipping');
    return { runId: '', startedAt: '', thresholdDays: 0, total: 0, successCount: 0, skipped: 0, errors: 0, cleared: 0, skippedDuplicate: true };
  }
  g.__syncTrainerTpgRunning = true;
  try {
    return await _runSyncTrainerToTpgInner();
  } finally {
    g.__syncTrainerTpgRunning = false;
  }
}

async function _runSyncTrainerToTpgInner() {
  await ensureLogTable();

  const runId = `sync_trainer_${Date.now()}`;
  const startedAt = new Date().toISOString();

  // Read threshold days
  const tpResult = await pool.query(
    `SELECT upcoming_classes_threshold_days FROM training_provider LIMIT 1`
  );
  const thresholdDays = parseInt(String(tpResult.rows[0]?.upcoming_classes_threshold_days || '21'), 10) || 21;

  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

  // ── Find runs needing attention (sanity-check scope) ─────────────────────────
  // The accept-invitation handler now auto-pushes accepted trainers to TPG, so
  // the scheduled run only needs to handle two cases:
  //   1. Missing TPG — local trainer assigned but tpg_assigned_trainer_name is empty
  //      (e.g. trainer assigned via admin UI without going through invitation,
  //       or accept-time TPG push failed transiently)
  //   2. Mismatched TPG — TPG trainer name differs from current local trainer
  //      (e.g. trainer was reassigned locally but TPG still has the old name)
  // Runs where TPG already matches local are filtered out at the SQL level so
  // we don't waste SSG API quota or rate-limit budget on already-synced runs.
  const runsResult = await pool.query<{
    id: string;
    course_run_id: string;
    course_ref_number: string;
    course_code: string;
    tpg_assigned_trainer_name: string | null;
    local_primary_name: string;
  }>(
    `WITH local_primary AS (
       -- One row per course_run with the primary local trainer (junction first, scalar fallback)
       SELECT cr.id AS course_run_uuid,
              COALESCE(
                (SELECT trainer_name FROM course_run_trainer
                  WHERE course_run_id = cr.id
                  ORDER BY assigned_at ASC LIMIT 1),
                NULLIF(cr.assigned_trainer_name, '')
              ) AS local_name
       FROM course_run cr
     )
     SELECT cr.id, cr.course_run_id, c.course_code,
            c.course_code AS course_ref_number,
            cr.tpg_assigned_trainer_name,
            lp.local_name AS local_primary_name
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     JOIN local_primary lp ON lp.course_run_uuid = cr.id
     WHERE cr.class_status = 'Confirmed'
       AND cr.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
       AND cr.start_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($1 * INTERVAL '1 day')
       AND lp.local_name IS NOT NULL
       AND (
         -- Case 1: TPG missing
         cr.tpg_assigned_trainer_name IS NULL
         OR cr.tpg_assigned_trainer_name = ''
         -- Case 2: TPG mismatched (case-insensitive comparison)
         OR LOWER(cr.tpg_assigned_trainer_name) <> LOWER(lp.local_name)
       )
     ORDER BY cr.course_run_id ASC`,
    [thresholdDays]
  );

  console.log(`🎓 sync-trainer-to-tpg (sanity check): ${runsResult.rows.length} run(s) need attention (missing or mismatched TPG)`);

  let successCount = 0, errors = 0, skipped = 0;

  for (const run of runsResult.rows) {
    try {
      await sleep(RATE_LIMIT_MS);

      // ── Collect all trainers: junction table first, scalar fallback ──────────
      interface TrainerCandidate {
        name: string;
        email: string | null;
        trainerId: string | null;
      }

      const junctionResult = await pool.query<{
        trainer_name: string;
        trainer_email: string | null;
        trainer_id: string | null;
      }>(
        `SELECT trainer_name, trainer_email, trainer_id
         FROM course_run_trainer
         WHERE course_run_id = $1
         ORDER BY assigned_at ASC`,
        [run.id]
      );

      let candidates: TrainerCandidate[];

      if (junctionResult.rows.length > 0) {
        // Junction table is the preferred source
        candidates = junctionResult.rows.map(r => ({
          name: r.trainer_name,
          email: r.trainer_email,
          trainerId: r.trainer_id,
        }));
      } else {
        // Fall back to scalar columns
        const scalarResult = await pool.query<{
          assigned_trainer_name: string;
          assigned_trainer_email: string | null;
          assigned_trainer_id: string | null;
        }>(
          `SELECT assigned_trainer_name, assigned_trainer_email, assigned_trainer_id
           FROM course_run WHERE id = $1`,
          [run.id]
        );
        const s = scalarResult.rows[0];
        if (s?.assigned_trainer_name) {
          candidates = [{ name: s.assigned_trainer_name, email: s.assigned_trainer_email, trainerId: s.assigned_trainer_id }];
        } else {
          candidates = [];
        }
      }

      if (candidates.length === 0) {
        skipped++;
        continue;
      }

      // ── Check if TPG already matches local — skip if so ────────────────────
      const tpgName = (run.tpg_assigned_trainer_name || '').trim().toLowerCase();
      const localPrimaryName = candidates[0].name.trim().toLowerCase();
      if (tpgName && tpgName === localPrimaryName) {
        // TPG matches local — nothing to do
        skipped++;
        continue;
      }

      if (tpgName) {
        console.log(`  🔄 ${run.course_run_id} | MISMATCH: TPG="${run.tpg_assigned_trainer_name}" vs Local="${candidates[0].name}" — will override`);
      }

      // ── Resolve NRIC for each trainer ───────────────────────────────────────
      const trainerPayloads: RunTrainerEditInfo[] = [];
      const resolvedTrainers: { name: string; email: string; nric: string }[] = [];
      let allSkipped = true;

      for (const candidate of candidates) {
        let nric: string | null = null;
        let resolvedEmail = candidate.email || '';

        // 1. Best: by trainer_id UUID
        if (candidate.trainerId) {
          const idResult = await pool.query<{ nric: string | null; email: string }>(
            `SELECT tp.nric, au.email
             FROM trainer_profile tp
             JOIN app_user au ON au.id = tp.user_id
             WHERE au.id = $1
             LIMIT 1`,
            [candidate.trainerId]
          );
          if (idResult.rows.length > 0) {
            nric = idResult.rows[0].nric || null;
            resolvedEmail = idResult.rows[0].email || resolvedEmail;
          }
        }

        // 2. Fallback: by email
        if (!nric && candidate.email) {
          const emailResult = await pool.query<{ nric: string | null; email: string }>(
            `SELECT tp.nric, au.email
             FROM trainer_profile tp
             JOIN app_user au ON au.id = tp.user_id
             WHERE LOWER(au.email) = LOWER($1)
                OR LOWER(au.secondary_email) = LOWER($1)
             LIMIT 1`,
            [candidate.email]
          );
          if (emailResult.rows.length > 0) {
            nric = emailResult.rows[0].nric || null;
            resolvedEmail = emailResult.rows[0].email || resolvedEmail;
          }
        }

        // 3. Last resort: partial name match
        if (!nric && candidate.name) {
          const nameResult = await pool.query<{ nric: string | null; email: string }>(
            `SELECT tp.nric, au.email
             FROM trainer_profile tp
             JOIN app_user au ON au.id = tp.user_id
             WHERE LOWER(au.full_name) LIKE '%' || LOWER($1) || '%'
                OR LOWER($1) LIKE '%' || LOWER(au.full_name) || '%'
             LIMIT 1`,
            [candidate.name]
          );
          if (nameResult.rows.length > 0) {
            nric = nameResult.rows[0].nric || null;
            resolvedEmail = nameResult.rows[0].email || resolvedEmail;
          }
        }

        const hasNric = !!(nric && nric.trim() && nric.trim().toUpperCase() !== 'NA');

        console.log(
          `  👤 ${run.course_run_id} | trainer: ${candidate.name} | email: ${resolvedEmail} | ` +
          `NRIC: ${hasNric ? maskNric(nric!) : 'NOT IN DATABASE'}`
        );

        // Log each trainer to DB
        await pool.query(
          `INSERT INTO sync_trainer_tpg_log
             (run_id, course_run_id, course_run_uuid, course_code, course_ref_number,
              trainer_name, trainer_email, nric_present, nric_masked,
              status, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            runId, run.course_run_id, run.id, run.course_code, run.course_ref_number,
            candidate.name, resolvedEmail,
            hasNric, hasNric ? maskNric(nric!) : null,
            hasNric ? 'pending' : 'skipped',
            hasNric ? null : 'No valid NRIC on file',
          ]
        );

        if (!hasNric) {
          console.log(`  ⏭️  ${run.course_run_id} | trainer ${candidate.name} has no valid NRIC — skipping`);
          continue;
        }

        allSkipped = false;
        trainerPayloads.push({
          trainerTypeCode: TrainerType.EXISTING,
          trainerTypeDescription: 'Existing',
          trainerIdNumber: nric!.trim(),
        });
        resolvedTrainers.push({ name: candidate.name, email: resolvedEmail, nric: nric! });
      }

      if (allSkipped || trainerPayloads.length === 0) {
        // All trainers had no NRIC — record the reason on course_run for UI
        await pool.query(
          `UPDATE course_run SET tpg_sync_status = 'no_nric', updated_at = NOW() WHERE id = $1`,
          [run.id]
        );
        skipped++;
        continue;
      }

      // ── Submit all trainers in one SSG call ─────────────────────────────────
      const editRes = await courseApi.editCourseRunTrainerOnly(
        run.course_run_id,
        {
          courseReferenceNumber: run.course_ref_number,
          linkCourseRunTrainer: trainerPayloads,
        }
      );

      const ssgStatus = editRes.status ?? 0;
      const hasEditError = editRes.error && (editRes.error.code || editRes.error.message);
      const ssgResponseText = hasEditError
        ? JSON.stringify(editRes.error)
        : JSON.stringify(editRes.data ?? {});

      if (hasEditError || (ssgStatus !== 200 && ssgStatus !== 201)) {
        const ssgErrorMsg = editRes.error?.message || '';
        const syncStatus = classifySsgError(ssgErrorMsg, ssgStatus);

        console.error(
          `  ❌ ${run.course_run_id} | SSG edit failed (${ssgStatus}): ${ssgErrorMsg || ssgResponseText}`
        );

        // If this was a mismatch override attempt that failed, clear the stale TPG assignment
        // so the UI shows the error instead of a wrong trainer name
        if (tpgName) {
          console.log(`  🧹 ${run.course_run_id} | clearing stale TPG trainer (was "${run.tpg_assigned_trainer_name}")`);
          await pool.query(
            `UPDATE course_run
             SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
                 tpg_sync_status = $2, updated_at = NOW()
             WHERE id = $1`,
            [run.id, syncStatus]
          );
        } else {
          await pool.query(
            `UPDATE course_run SET tpg_sync_status = $2, updated_at = NOW() WHERE id = $1`,
            [run.id, syncStatus]
          );
        }

        await pool.query(
          `UPDATE sync_trainer_tpg_log
           SET status = 'error', ssg_status = $1, ssg_response = $2, error_message = $3
           WHERE run_id = $4 AND course_run_id = $5 AND status = 'pending'`,
          [ssgStatus, ssgResponseText, ssgErrorMsg || 'SSG edit failed', runId, run.course_run_id]
        );

        errors++;
        continue;
      }

      // ── On success: write first trainer to tpg_assigned columns (scalar) ────
      // Scalar columns only hold one trainer — use the first resolved trainer.
      // All trainers are submitted to SSG via the array payload above.
      const primary = resolvedTrainers[0];
      await pool.query(
        `UPDATE course_run
         SET tpg_assigned_trainer_name  = $2,
             tpg_assigned_trainer_email = $3,
             tpg_sync_status = 'synced',
             updated_at = NOW()
         WHERE id = $1`,
        [run.id, primary.name, primary.email || null]
      );

      await pool.query(
        `UPDATE sync_trainer_tpg_log
         SET status = 'success', ssg_status = $1, ssg_response = $2
         WHERE run_id = $3 AND course_run_id = $4 AND status = 'pending'`,
        [ssgStatus, ssgResponseText, runId, run.course_run_id]
      );

      const trainerNames = resolvedTrainers.map(t => t.name).join(', ');
      console.log(`  ✅ ${run.course_run_id} | synced ${resolvedTrainers.length} trainer(s) to SSG: ${trainerNames}`);
      successCount++;

    } catch (err: any) {
      console.error(`  ❌ ${run.course_run_id}:`, err.message);
      await pool.query(
        `UPDATE sync_trainer_tpg_log
         SET status = 'error', error_message = $1
         WHERE run_id = $2 AND course_run_id = $3`,
        [err.message, runId, run.course_run_id]
      ).catch(() => {});
      errors++;
    }
  }

  // ── Cleanup: clear TPG assignment where no local trainer exists ──────────
  // If a local trainer was removed but TPG still has someone, clear the stale
  // TPG columns so the UI doesn't show a trainer that's no longer assigned.
  const staleResult = await pool.query(
    `SELECT cr.id, cr.course_run_id, cr.tpg_assigned_trainer_name
     FROM course_run cr
     LEFT JOIN course_run_trainer crt ON crt.course_run_id = cr.id
     WHERE cr.class_status = 'Confirmed'
       AND cr.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
       AND cr.start_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($1 * INTERVAL '1 day')
       AND (cr.tpg_assigned_trainer_name IS NOT NULL AND cr.tpg_assigned_trainer_name <> '')
       AND crt.trainer_name IS NULL
       AND (cr.assigned_trainer_name IS NULL OR cr.assigned_trainer_name = '')`,
    [thresholdDays]
  );

  let cleared = 0;
  for (const stale of staleResult.rows) {
    console.log(`  🧹 ${stale.course_run_id} | no local trainer but TPG has "${stale.tpg_assigned_trainer_name}" — clearing`);
    await pool.query(
      `UPDATE course_run
       SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
           tpg_sync_status = NULL, updated_at = NOW()
       WHERE id = $1`,
      [stale.id]
    );
    cleared++;
  }

  if (cleared > 0) {
    console.log(`  🧹 Cleared ${cleared} stale TPG assignment(s) with no local trainer`);
  }

  console.log(
    `✅ sync-trainer-to-tpg done — ${successCount} synced, ${skipped} skipped, ${errors} error(s), ${cleared} stale cleared`
  );
  return { runId, startedAt, thresholdDays, total: runsResult.rows.length, successCount, skipped, errors, cleared };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runSyncTrainerToTpg();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ sync-trainer-to-tpg error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
