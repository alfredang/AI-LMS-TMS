/**
 * Server-side collector: build the tagged trainer list for ONE run from the DB
 * (LMS junction + accepted invitations + the cached TPG assignment). Pure merge logic
 * lives in ./taggedTrainers (client-safe); this adds the DB reads (server-only).
 */
import pool from '../db';
import { mergeTaggedTrainers, type TaggedTrainer } from './taggedTrainers';

/** courseRunUuid = course_run.id (the UUID, not the SSG run id). */
export async function collectRunTaggedTrainers(courseRunUuid: string): Promise<TaggedTrainer[]> {
  const [lms, accepted, tpg] = await Promise.all([
    pool.query<{ trainer_name: string; trainer_email: string | null }>(
      `SELECT trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1`,
      [courseRunUuid]
    ),
    pool.query<{ trainer_name: string; trainer_email: string | null }>(
      `SELECT trainer_name, trainer_email FROM trainer_invitation WHERE course_run_id = $1 AND status = 'accepted'`,
      [courseRunUuid]
    ),
    pool.query<{ tpg_assigned_trainer_name: string | null; tpg_assigned_trainer_email: string | null }>(
      `SELECT tpg_assigned_trainer_name, tpg_assigned_trainer_email FROM course_run WHERE id = $1`,
      [courseRunUuid]
    ),
  ]);
  const tpgRow = tpg.rows[0];
  return mergeTaggedTrainers({
    lms: lms.rows.map((r) => ({ name: r.trainer_name, email: r.trainer_email })),
    accepted: accepted.rows.map((r) => ({ name: r.trainer_name, email: r.trainer_email })),
    tpg: (tpgRow?.tpg_assigned_trainer_name || '').trim()
      ? [{ name: tpgRow!.tpg_assigned_trainer_name, email: tpgRow!.tpg_assigned_trainer_email }]
      : [],
  });
}
