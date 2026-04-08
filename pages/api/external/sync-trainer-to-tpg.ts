import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { TrainerType } from '../../../lib/ssg/models/course-runs';
import type { RunTrainerEditInfo } from '../../../lib/ssg/models/edit-delete-course-run';


/**
 * External API — Sync Trainer (Local) to TPG/SSG
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily after "Fetch TGS Enrolments & Assign Trainers"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Find all upcoming course runs that have a local trainer assigned
 *      (course_run_trainer) but no TPG trainer yet (tpg_assigned_trainer_name IS NULL).
 *   2. For each run, resolve the trainer's NRIC via:
 *        a. app_user.email or app_user.secondary_email  → trainer_profile.nric
 *   3. Call SSG Edit Course Run with linkCourseRunTrainer payload.
 *   4. On success, write tpg_assigned_trainer_name/email to course_run.
 *   5. Log each attempt with NRIC presence status and SSG response.
 *
 * POST /api/external/sync-trainer-to-tpg
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_MS = 2000;

// ── Ensure log table ──────────────────────────────────────────────────────────

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
}

// ── Mask NRIC for logging (show first + last char only) ───────────────────────

function maskNric(nric: string): string {
  if (!nric || nric.length < 3) return '***';
  return `${nric[0]}${'*'.repeat(nric.length - 2)}${nric[nric.length - 1]}`;
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runSyncTrainerToTpg() {
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

  // ── Find runs: has local trainer, no TPG trainer, upcoming within threshold ─
  const runsResult = await pool.query<{
    id: string;
    course_run_id: string;
    course_ref_number: string;
    course_code: string;
  }>(
    `SELECT cr.id, cr.course_run_id, c.course_code,
            c.course_code AS course_ref_number
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.class_status IN ('Confirmed', 'Pending')
       AND cr.start_date >= CURRENT_DATE
       AND cr.start_date <= CURRENT_DATE + ($1 * INTERVAL '1 day')
       AND (cr.tpg_assigned_trainer_name IS NULL OR cr.tpg_assigned_trainer_name = '')
       AND EXISTS (
         SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id
       )
     ORDER BY cr.start_date ASC`,
    [thresholdDays]
  );

  console.log(`🎓 sync-trainer-to-tpg: ${runsResult.rows.length} run(s) to sync`);

  let successCount = 0, errors = 0, skipped = 0;

  for (const run of runsResult.rows) {
    try {
      await sleep(RATE_LIMIT_MS);

      // ── Get local trainers from junction table (in assignment order) ─────────
      const trainersResult = await pool.query<{
        trainer_name: string;
        trainer_email: string;
        trainer_id: string | null;
      }>(
        `SELECT trainer_name, trainer_email, trainer_id
         FROM course_run_trainer
         WHERE course_run_id = $1
         ORDER BY assigned_at ASC`,
        [run.id]
      );

      if (trainersResult.rows.length === 0) {
        console.log(`  ⏭️  ${run.course_run_id} | no local trainers found — skipping`);
        skipped++;
        continue;
      }

      // ── Resolve NRIC for each trainer via app_user email → trainer_profile ───
      const trainerPayloads: RunTrainerEditInfo[] = [];

      for (const t of trainersResult.rows) {
        let nric: string | null = null;
        let resolvedEmail = t.trainer_email || '';

        if (resolvedEmail) {
          // Look up by primary email first, then secondary email
          const nricResult = await pool.query<{ nric: string | null; email: string }>(
            `SELECT tp.nric, au.email
             FROM trainer_profile tp
             JOIN app_user au ON au.id = tp.user_id
             WHERE LOWER(au.email) = LOWER($1)
                OR LOWER(au.secondary_email) = LOWER($1)
             LIMIT 1`,
            [resolvedEmail]
          );

          if (nricResult.rows.length > 0) {
            nric = nricResult.rows[0].nric || null;
            resolvedEmail = nricResult.rows[0].email || resolvedEmail;
          }
        }

        const hasNric = !!(nric && nric.trim() && nric.trim().toUpperCase() !== 'NA');

        // Log NRIC presence per trainer
        console.log(
          `  👤 ${run.course_run_id} | trainer: ${t.trainer_name} | email: ${resolvedEmail} | ` +
          `NRIC: ${hasNric ? maskNric(nric!) : 'NOT ON FILE'}`
        );

        // Build SSG trainer payload
        // For EXISTING trainer type: only send trainerType + idNumber.
        // SSG fetches name/email from TP Profile using the ID number.
        const trainerEntry: RunTrainerEditInfo = {
          trainerTypeCode: TrainerType.EXISTING,
          trainerTypeDescription: 'Existing',
          ...(hasNric && {
            trainerIdNumber: nric!.trim(),
          }),
        };

        trainerPayloads.push(trainerEntry);

        // Log to DB per trainer
        await pool.query(
          `INSERT INTO sync_trainer_tpg_log
             (run_id, course_run_id, course_run_uuid, course_code, course_ref_number,
              trainer_name, trainer_email, nric_present, nric_masked,
              status, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL)`,
          [
            runId, run.course_run_id, run.id, run.course_code, run.course_ref_number,
            t.trainer_name, resolvedEmail,
            hasNric, hasNric ? maskNric(nric!) : null,
          ]
        );
      }

      // ── Call SSG Edit Course Run with trainer-only payload ───────────────────
      // Uses editCourseRunTrainerOnly to send a minimal payload with only
      // linkCourseRunTrainer — avoids accidentally overwriting dates/venue/etc.
      const editRes = await courseApi.editCourseRunTrainerOnly(
        run.course_run_id,
        {
          courseReferenceNumber: run.course_ref_number,
          linkCourseRunTrainer: trainerPayloads,
        }
      );

      const ssgStatus = editRes.status ?? 0;
      const ssgResponseText = editRes.error
        ? JSON.stringify(editRes.error)
        : JSON.stringify(editRes.data ?? {});

      if (editRes.error || (ssgStatus !== 200 && ssgStatus !== 201)) {
        console.error(
          `  ❌ ${run.course_run_id} | SSG edit failed (${ssgStatus}): ${editRes.error?.message || ssgResponseText}`
        );

        // Update all log rows for this run to 'error'
        await pool.query(
          `UPDATE sync_trainer_tpg_log
           SET status = 'error', ssg_status = $1, ssg_response = $2, error_message = $3
           WHERE run_id = $4 AND course_run_id = $5`,
          [ssgStatus, ssgResponseText, editRes.error?.message || 'SSG edit failed', runId, run.course_run_id]
        );

        errors++;
        continue;
      }

      // ── On success: write tpg_assigned_trainer_name/email from first trainer ─
      const primary = trainersResult.rows[0];
      await pool.query(
        `UPDATE course_run
         SET tpg_assigned_trainer_name  = $2,
             tpg_assigned_trainer_email = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [run.id, primary.trainer_name, primary.trainer_email || null]
      );

      // Update all log rows for this run to 'success'
      await pool.query(
        `UPDATE sync_trainer_tpg_log
         SET status = 'success', ssg_status = $1, ssg_response = $2
         WHERE run_id = $3 AND course_run_id = $4`,
        [ssgStatus, ssgResponseText, runId, run.course_run_id]
      );

      console.log(
        `  ✅ ${run.course_run_id} | synced ${trainerPayloads.length} trainer(s) to SSG: ` +
        trainerPayloads.map(t => t.trainerName).join(', ')
      );
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

  console.log(
    `✅ sync-trainer-to-tpg done — ${successCount} synced, ${skipped} skipped, ${errors} error(s)`
  );
  return { runId, startedAt, thresholdDays, total: runsResult.rows.length, successCount, skipped, errors };
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
