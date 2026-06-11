import pool from '../db';
import { getSSGCredentialsService } from '../ssg/services/credentials-service';
import { createSSGCourseAPI } from '../ssg/api/course-api';
import { classifySsgError } from '../../pages/api/external/sync-trainer-to-tpg';
import { triggerClassCalendarSync } from '../calendar/triggerClassCalendarSync';

/**
 * "Unconfirm" a class: the assigned trainer fell through, so reset the run to a
 * clean awaiting-trainer state and let re-sourcing happen. Atomic local reset +
 * best-effort SSG trainer removal.
 *
 * Does ALL of (per unconfirm-lifecycle-spec.md):
 *   1. class_status = 'Unconfirmed'
 *   2. clear the local trainer — delete course_run_trainer rows AND null the
 *      legacy assigned_trainer_* scalars (both representations stay consistent)
 *   3. supersede open/accepted trainer_invitation rows so a fresh invite can issue
 *   4. remove the trainer from SSG/TPG by replacing the run's trainer list with an
 *      EMPTY list (UAT-verified mechanism; action:'delete' does NOT work). Skipped
 *      when the run was never pushed to TPG. On SSG failure: record tpg_sync_status,
 *      do NOT block the local reset (re-assignment later overwrites SSG anyway).
 *   5. calendar: keep the event (still has learners), just drop the trainer from
 *      attendees via triggerClassCalendarSync (only Cancelled removes events).
 *
 * Never throws SSG failures — they are classified onto tpg_sync_status. Returns a
 * summary. Pass { skipSsg:true } to do a pure local reset (used by local testing).
 */
export interface UnconfirmResult {
  status: 'ok' | 'error';
  trainersCleared: number;
  invitationsSuperseded: number;
  ssg: 'skipped_no_tpg' | 'cleared' | 'failed' | 'skipped_flag';
  ssgStatus?: number;
  message?: string;
}

export async function unconfirmClass(
  courseRunUuid: string,
  opts: { skipSsg?: boolean } = {}
): Promise<UnconfirmResult> {
  const out: UnconfirmResult = { status: 'ok', trainersCleared: 0, invitationsSuperseded: 0, ssg: 'skipped_no_tpg' };

  const cr = (await pool.query<{
    id: string; course_run_id: string; course_code: string;
    tpg_assigned_trainer_name: string | null; tpg_assigned_trainer_email: string | null; tpg_sync_status: string | null;
  }>(
    `SELECT cr.id, cr.course_run_id, c.course_code,
            cr.tpg_assigned_trainer_name, cr.tpg_assigned_trainer_email, cr.tpg_sync_status
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
    [courseRunUuid]
  )).rows[0];
  if (!cr) return { ...out, status: 'error', message: 'course run not found' };

  const wasPushedToTpg = !!(cr.tpg_assigned_trainer_name || cr.tpg_assigned_trainer_email || cr.tpg_sync_status === 'synced');

  // --- atomic local reset (steps 1-3) ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE course_run SET class_status = 'Unconfirmed', updated_at = NOW() WHERE id = $1`, [cr.id]);

    const del = await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [cr.id]);
    out.trainersCleared = del.rowCount || 0;
    await client.query(
      `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
      [cr.id]
    );

    const sup = await client.query(
      `UPDATE trainer_invitation SET status = 'superseded', updated_at = NOW()
        WHERE course_run_id = $1 AND status IN ('pending','accepted','resent')`,
      [cr.id]
    );
    out.invitationsSuperseded = sup.rowCount || 0;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    return { ...out, status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  client.release();

  // --- step 4: SSG trainer removal (best-effort, non-blocking) ---
  if (opts.skipSsg) {
    out.ssg = 'skipped_flag';
  } else if (wasPushedToTpg) {
    try {
      const credentials = await getSSGCredentialsService().getSSGCredentials();
      if (credentials) {
        const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
        const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);
        const editRes = await courseApi.editCourseRunTrainerOnly(cr.course_run_id, {
          courseReferenceNumber: cr.course_code,
          linkCourseRunTrainer: [], // empty list = clear all trainers (UAT-verified)
        });
        const ssgStatus = editRes.status ?? 0;
        const hasErr = editRes.error && (editRes.error.code || editRes.error.message);
        if (hasErr || (ssgStatus !== 200 && ssgStatus !== 201)) {
          const syncStatus = classifySsgError(editRes.error?.message || '', ssgStatus);
          await pool.query(`UPDATE course_run SET tpg_sync_status = $2, updated_at = NOW() WHERE id = $1`, [cr.id, syncStatus]);
          out.ssg = 'failed'; out.ssgStatus = ssgStatus; out.message = editRes.error?.message || 'SSG rejected';
        } else {
          await pool.query(
            `UPDATE course_run SET tpg_assigned_trainer_id = NULL, tpg_assigned_trainer_name = NULL,
                                    tpg_assigned_trainer_email = NULL, tpg_sync_status = 'unconfirmed_cleared', updated_at = NOW()
              WHERE id = $1`,
            [cr.id]
          );
          out.ssg = 'cleared'; out.ssgStatus = ssgStatus;
        }
      } else {
        out.ssg = 'failed'; out.message = 'SSG credentials not configured';
      }
    } catch (e) {
      await pool.query(`UPDATE course_run SET tpg_sync_status = 'error', updated_at = NOW() WHERE id = $1`, [cr.id]).catch(() => {});
      out.ssg = 'failed'; out.message = e instanceof Error ? e.message : String(e);
    }
  }

  // --- step 5: calendar keeps the event, drops the (now-removed) trainer ---
  triggerClassCalendarSync(cr.id);

  return out;
}
