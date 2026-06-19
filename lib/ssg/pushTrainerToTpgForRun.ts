import pool from '../db';
import { getSSGCredentialsService } from './services/credentials-service';
import { createSSGCourseAPI } from './api/course-api';
import { TrainerType, type RunTrainerEditInfo } from './models/course-runs';
import { classifySsgError } from '../../pages/api/external/sync-trainer-to-tpg';

export interface PushTrainerResult {
  status: 'synced' | 'skipped_no_trainer' | 'skipped_no_nric' | 'no_tpg_profile' | 'error';
  message: string;
  trainerName?: string;
  trainerEmail?: string;
  ssgStatus?: number;
}

/**
 * Push the locally-assigned trainer for one course run to SSG / TPGateway.
 *
 * Resolves trainer details from `course_run_trainer` (preferred) or the
 * legacy `assigned_trainer_*` scalars on `course_run`. Looks up NRIC from
 * `trainer_profile` keyed by trainer_id → email → name. On SSG success
 * writes `tpg_assigned_trainer_*` and `tpg_sync_status='synced'`. On error
 * writes `tpg_sync_status` to a classified error code.
 *
 * Designed to be called from the trainer-invitation accept handler so a
 * trainer accepting an invitation also propagates to SSG without an admin
 * needing to click "Bulk TPG Assign". Safe to call even when SSG is
 * unreachable — failures are recorded on `tpg_sync_status` and returned
 * to the caller; never throws.
 */
/**
 * Resolve a run's trainers into SSG edit payloads (with real NRIC from trainer_profile), so they
 * can be INCLUDED in a session add/update/delete edit — otherwise SSG drops the run's trainer
 * whenever the run is edited without `linkCourseRunTrainer`. Trainers with no NRIC are skipped
 * (they can't exist on SSG anyway). Mirrors the resolution in pushTrainerToTpgForRun.
 */
export async function resolveRunTrainerEditPayloads(courseRunUuid: string): Promise<any[]> {
  interface Candidate { name: string; email: string | null; trainerId: string | null; }
  const junction = await pool.query<{ trainer_name: string; trainer_email: string | null; trainer_id: string | null }>(
    `SELECT trainer_name, trainer_email, trainer_id FROM course_run_trainer WHERE course_run_id = $1 ORDER BY assigned_at ASC`,
    [courseRunUuid]
  );
  let candidates: Candidate[];
  if (junction.rows.length > 0) {
    candidates = junction.rows.map((r) => ({ name: r.trainer_name, email: r.trainer_email, trainerId: r.trainer_id }));
  } else {
    const s = (await pool.query<{ assigned_trainer_name: string | null; assigned_trainer_email: string | null; assigned_trainer_id: string | null }>(
      `SELECT assigned_trainer_name, assigned_trainer_email, assigned_trainer_id FROM course_run WHERE id = $1`, [courseRunUuid]
    )).rows[0];
    candidates = s?.assigned_trainer_name ? [{ name: s.assigned_trainer_name, email: s.assigned_trainer_email, trainerId: s.assigned_trainer_id }] : [];
  }

  const payloads: any[] = [];
  for (const cand of candidates) {
    let nric: string | null = null;
    if (cand.trainerId) {
      const r = await pool.query<{ nric: string | null }>(`SELECT tp.nric FROM trainer_profile tp WHERE tp.user_id = $1 LIMIT 1`, [cand.trainerId]);
      if (r.rows[0]) nric = r.rows[0].nric;
    }
    if (!nric && cand.email) {
      const r = await pool.query<{ nric: string | null }>(
        `SELECT tp.nric FROM trainer_profile tp JOIN app_user au ON au.id = tp.user_id
          WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1) LIMIT 1`, [cand.email]);
      if (r.rows[0]) nric = r.rows[0].nric;
    }
    if (!nric && cand.name) {
      const r = await pool.query<{ nric: string | null }>(
        `SELECT tp.nric FROM trainer_profile tp JOIN app_user au ON au.id = tp.user_id
          WHERE LOWER(au.full_name) LIKE '%' || LOWER($1) || '%' OR LOWER($1) LIKE '%' || LOWER(au.full_name) || '%' LIMIT 1`, [cand.name]);
      if (r.rows[0]) nric = r.rows[0].nric;
    }
    const hasNric = !!(nric && nric.trim() && nric.trim().toUpperCase() !== 'NA');
    if (!hasNric) continue;
    payloads.push({ trainerTypeCode: TrainerType.EXISTING, trainerTypeDescription: 'Existing', trainerIdNumber: nric!.trim() });
  }
  return payloads;
}

export async function pushTrainerToTpgForRun(courseRunUuid: string, opts?: { onlyEmail?: string }): Promise<PushTrainerResult> {
  try {
    const crResult = await pool.query<{
      id: string;
      course_run_id: string;
      course_code: string;
    }>(
      `SELECT cr.id, cr.course_run_id, c.course_code
       FROM course_run cr JOIN course c ON c.id = cr.course_id
       WHERE cr.id = $1`,
      [courseRunUuid]
    );
    if (!crResult.rows[0]) {
      return { status: 'error', message: 'Course run not found' };
    }
    const { course_run_id: ssgRunId, course_code } = crResult.rows[0];

    // Resolve trainers from junction first, then scalar fallback
    interface Candidate { name: string; email: string | null; trainerId: string | null; }
    const junction = await pool.query<{
      trainer_name: string; trainer_email: string | null; trainer_id: string | null;
    }>(
      `SELECT trainer_name, trainer_email, trainer_id
       FROM course_run_trainer WHERE course_run_id = $1
       ORDER BY assigned_at ASC`,
      [courseRunUuid]
    );

    let candidates: Candidate[];
    if (junction.rows.length > 0) {
      candidates = junction.rows.map(r => ({
        name: r.trainer_name, email: r.trainer_email, trainerId: r.trainer_id,
      }));
    } else {
      const scalar = await pool.query<{
        assigned_trainer_name: string | null;
        assigned_trainer_email: string | null;
        assigned_trainer_id: string | null;
      }>(
        `SELECT assigned_trainer_name, assigned_trainer_email, assigned_trainer_id
         FROM course_run WHERE id = $1`,
        [courseRunUuid]
      );
      const s = scalar.rows[0];
      candidates = s?.assigned_trainer_name
        ? [{ name: s.assigned_trainer_name, email: s.assigned_trainer_email, trainerId: s.assigned_trainer_id }]
        : [];
    }

    // Optionally push ONLY a specific trainer (the chosen TPG target on a move), not all
    // junction trainers — LMS may carry many but TPG should get just the selected one.
    if (opts?.onlyEmail) {
      const want = opts.onlyEmail.toLowerCase().trim();
      candidates = candidates.filter((c) => (c.email || '').toLowerCase().trim() === want);
    }

    if (candidates.length === 0) {
      return { status: 'skipped_no_trainer', message: 'No local trainer assigned' };
    }

    const trainerPayloads: RunTrainerEditInfo[] = [];
    const resolved: { name: string; email: string }[] = [];

    for (const cand of candidates) {
      let nric: string | null = null;
      let email = cand.email || '';

      if (cand.trainerId) {
        const r = await pool.query<{ nric: string | null; email: string }>(
          `SELECT tp.nric, au.email FROM trainer_profile tp
           JOIN app_user au ON au.id = tp.user_id WHERE au.id = $1 LIMIT 1`,
          [cand.trainerId]
        );
        if (r.rows[0]) { nric = r.rows[0].nric; email = r.rows[0].email || email; }
      }
      if (!nric && cand.email) {
        const r = await pool.query<{ nric: string | null; email: string }>(
          `SELECT tp.nric, au.email FROM trainer_profile tp
           JOIN app_user au ON au.id = tp.user_id
           WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1) LIMIT 1`,
          [cand.email]
        );
        if (r.rows[0]) { nric = r.rows[0].nric; email = r.rows[0].email || email; }
      }
      if (!nric && cand.name) {
        const r = await pool.query<{ nric: string | null; email: string }>(
          `SELECT tp.nric, au.email FROM trainer_profile tp
           JOIN app_user au ON au.id = tp.user_id
           WHERE LOWER(au.full_name) LIKE '%' || LOWER($1) || '%'
              OR LOWER($1) LIKE '%' || LOWER(au.full_name) || '%' LIMIT 1`,
          [cand.name]
        );
        if (r.rows[0]) { nric = r.rows[0].nric; email = r.rows[0].email || email; }
      }

      const hasNric = !!(nric && nric.trim() && nric.trim().toUpperCase() !== 'NA');
      if (!hasNric) continue;

      trainerPayloads.push({
        trainerTypeCode: TrainerType.EXISTING,
        trainerTypeDescription: 'Existing',
        trainerIdNumber: nric!.trim(),
      });
      resolved.push({ name: cand.name, email });
    }

    if (trainerPayloads.length === 0) {
      await pool.query(
        `UPDATE course_run SET tpg_sync_status = 'no_nric', updated_at = NOW() WHERE id = $1`,
        [courseRunUuid]
      );
      return { status: 'skipped_no_nric', message: 'No trainer with NRIC on file' };
    }

    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return { status: 'error', message: 'SSG credentials not configured' };
    }
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

    const editRes = await courseApi.editCourseRunTrainerOnly(ssgRunId, {
      courseReferenceNumber: course_code,
      linkCourseRunTrainer: trainerPayloads,
    });

    const ssgStatus = editRes.status ?? 0;
    const hasErr = editRes.error && (editRes.error.code || editRes.error.message);
    if (hasErr || (ssgStatus !== 200 && ssgStatus !== 201)) {
      const ssgErrMsg = editRes.error?.message || '';
      const syncStatus = classifySsgError(ssgErrMsg, ssgStatus);
      if (syncStatus === 'no_tpg_profile') {
        await pool.query(
          `UPDATE course_run SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
                                  tpg_sync_status = 'no_tpg_profile', updated_at = NOW()
           WHERE id = $1`,
          [courseRunUuid]
        );
        return { status: 'no_tpg_profile', message: 'Trainer not registered in SSG TP Profile', ssgStatus };
      }
      await pool.query(
        `UPDATE course_run SET tpg_sync_status = $2, updated_at = NOW() WHERE id = $1`,
        [courseRunUuid, syncStatus]
      );
      return { status: 'error', message: ssgErrMsg || 'SSG rejected', ssgStatus };
    }

    const primary = resolved[0];
    await pool.query(
      `UPDATE course_run
       SET tpg_assigned_trainer_name = $2,
           tpg_assigned_trainer_email = $3,
           tpg_sync_status = 'synced',
           class_status = CASE
             WHEN class_status = 'Pending'
                  AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = course_run.id)
             THEN 'Confirmed' ELSE class_status END,
           updated_at = NOW()
       WHERE id = $1`,
      [courseRunUuid, primary.name, primary.email || null]
    );
    return { status: 'synced', message: 'Trainer pushed to TPG', trainerName: primary.name, trainerEmail: primary.email, ssgStatus };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: msg };
  }
}

/**
 * Clear the trainer(s) for one course run on SSG / TPGateway (used when a class is
 * moved off a now-vacated source run). `editCourseRunTrainerOnly` REPLACES the SSG
 * trainer list, so an empty `linkCourseRunTrainer` removes it. Skips the SSG call when
 * the run had no TPG trainer on file. Never throws — records `tpg_sync_status`.
 */
export async function clearTrainerOnTpgForRun(courseRunUuid: string): Promise<PushTrainerResult> {
  try {
    const crResult = await pool.query<{ id: string; course_run_id: string; course_code: string; tpg_assigned_trainer_name: string | null; tpg_sync_status: string | null; }>(
      `SELECT cr.id, cr.course_run_id, c.course_code, cr.tpg_assigned_trainer_name, cr.tpg_sync_status
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id = $1`,
      [courseRunUuid]
    );
    const row = crResult.rows[0];
    if (!row) return { status: 'error', message: 'Course run not found' };

    // Nothing on TPG to clear → don't bother calling SSG.
    const hadTpgTrainer = !!(row.tpg_assigned_trainer_name && row.tpg_assigned_trainer_name.trim()) || row.tpg_sync_status === 'synced';
    if (!hadTpgTrainer) return { status: 'skipped_no_trainer', message: 'No TPG trainer to clear on the source run' };

    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return { status: 'error', message: 'SSG credentials not configured' };
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

    const editRes = await courseApi.editCourseRunTrainerOnly(row.course_run_id, {
      courseReferenceNumber: row.course_code,
      linkCourseRunTrainer: [],
    });
    const ssgStatus = editRes.status ?? 0;
    const hasErr = editRes.error && (editRes.error.code || editRes.error.message);
    if (hasErr || (ssgStatus !== 200 && ssgStatus !== 201)) {
      const ssgErrMsg = editRes.error?.message || '';
      const syncStatus = classifySsgError(ssgErrMsg, ssgStatus);
      await pool.query(`UPDATE course_run SET tpg_sync_status = $2, updated_at = NOW() WHERE id = $1`, [courseRunUuid, syncStatus]);
      return { status: 'error', message: ssgErrMsg || 'SSG rejected trainer clear', ssgStatus };
    }

    await pool.query(
      `UPDATE course_run SET tpg_assigned_trainer_id = NULL, tpg_assigned_trainer_name = NULL,
                              tpg_assigned_trainer_email = NULL, tpg_sync_status = 'unassigned', updated_at = NOW()
        WHERE id = $1`,
      [courseRunUuid]
    );
    return { status: 'synced', message: 'Trainer cleared on TPG', ssgStatus };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export interface PullTrainerResult {
  ok: boolean;
  tpg: { name: string; email: string | null } | null; // first TPG trainer, or null if none
  changed: boolean;
  error?: string;
}

const pickField = (obj: any, keys: string[]): string => {
  for (const k of keys) {
    const v = k.split('.').reduce((o: any, kk: string) => (o == null ? o : o[kk]), obj);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

/**
 * Pull a run's CURRENT trainer from SSG/TPGateway (viewCourseRun → linkCourseRunTrainer) and
 * refresh the local `tpg_assigned_trainer_*` cache so the calendar/reschedulers reflect direct-TPG
 * edits. Per-run, on-demand (NOT for the whole grid). Never throws.
 */
export async function pullRunTpgTrainer(courseRunUuid: string): Promise<PullTrainerResult> {
  try {
    const cr = (await pool.query<{ course_run_id: string; tpg_assigned_trainer_name: string | null }>(
      `SELECT course_run_id, tpg_assigned_trainer_name FROM course_run WHERE id = $1`, [courseRunUuid]
    )).rows[0];
    if (!cr) return { ok: false, tpg: null, changed: false, error: 'Course run not found' };

    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return { ok: false, tpg: null, changed: false, error: 'SSG credentials not configured' };
    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGCourseAPI(ssgBaseUrl, credentials);

    const viewRes: any = await api.viewCourseRun(cr.course_run_id);
    if (viewRes?.error && (viewRes.error.code || viewRes.error.message)) {
      return { ok: false, tpg: null, changed: false, error: viewRes.error.message || 'viewCourseRun failed' };
    }
    const trainers: any[] = viewRes?.data?.course?.run?.linkCourseRunTrainer || [];
    const first = trainers.map((e) => {
      const t = e.trainer || e;
      return { name: pickField(t, ['name', 'trainerName', 'fullName']), email: pickField(t, ['email', 'emailAddress', 'trainerEmail']) };
    }).find((m) => m.name || m.email) || null;

    const newName = first?.name || null;
    const newEmail = first?.email || null;
    const changed = (cr.tpg_assigned_trainer_name || null) !== (newName || null);
    if (changed) {
      await pool.query(
        `UPDATE course_run SET tpg_assigned_trainer_name = $2, tpg_assigned_trainer_email = $3,
                                tpg_sync_status = $4, updated_at = NOW() WHERE id = $1`,
        [courseRunUuid, newName, newEmail, newName ? 'synced' : 'unassigned']
      );
    }
    return { ok: true, tpg: first, changed };
  } catch (err) {
    return { ok: false, tpg: null, changed: false, error: err instanceof Error ? err.message : String(err) };
  }
}
