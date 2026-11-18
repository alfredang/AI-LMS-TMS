import fs from 'fs';
import path from 'path';
import pool from '../db';

let ensured: Promise<void> | null = null;

/**
 * Lazily applies database/migrations/add_course_default_trainer.sql (column + trigger).
 * Migrations are not run on deploy, so the API self-heals the schema once per process.
 */
export function ensureCourseDefaultTrainerSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const col = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'course' AND column_name = 'default_trainer_id'`
      );
      const trg = await pool.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_apply_course_default_trainer' AND NOT tgisinternal`
      );
      if (col.rowCount && trg.rowCount) return;
      const file = path.join(process.cwd(), 'database', 'migrations', 'add_course_default_trainer.sql');
      const sql = fs.readFileSync(file, 'utf8');
      await pool.query(sql);
      console.log('[courseDefaultTrainer] schema ensured (course.default_trainer_id + trigger)');
    })().catch(err => { ensured = null; throw err; });
  }
  return ensured;
}

export interface TrainerOption { id: string; name: string; email: string }

/** Active trainers (Trainer role, profile not Inactive) for the picker. */
export async function listTrainerOptions(): Promise<TrainerOption[]> {
  const r = await pool.query(
    `SELECT DISTINCT u.id, u.full_name AS name, u.email
       FROM app_user u
       JOIN user_role_map m ON m.user_id = u.id AND m.role = 'Trainer'
       LEFT JOIN trainer_profile tp ON tp.user_id = u.id
      WHERE COALESCE(tp.status::text, 'Active') <> 'Inactive'
        AND u.email IS NOT NULL
      ORDER BY u.full_name ASC`
  );
  return r.rows;
}

/** Upcoming (not ended), non-cancelled runs of a course with no trainer at all. */
export async function listUnassignedUpcomingRuns(courseId: string): Promise<{ id: string; course_run_id: string; start_date: string }[]> {
  const r = await pool.query(
    `SELECT cr.id, cr.course_run_id, to_char(cr.start_date, 'YYYY-MM-DD') AS start_date
       FROM course_run cr
      WHERE cr.course_id = $1
        AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
        AND cr.class_status IS DISTINCT FROM 'Cancelled'
        AND cr.assigned_trainer_id IS NULL
        AND cr.tpg_assigned_trainer_id IS NULL
        AND NULLIF(BTRIM(COALESCE(cr.assigned_trainer_name, '')), '') IS NULL
        AND NULLIF(BTRIM(COALESCE(cr.tpg_assigned_trainer_name, '')), '') IS NULL
        AND NOT EXISTS (SELECT 1 FROM course_run_trainer t WHERE t.course_run_id = cr.id)
      ORDER BY cr.start_date`,
    [courseId]
  );
  return r.rows;
}

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * Keeps the course's default trainer at position 1 of the approved trainer list
 * (course.trainers_list, with trainers_email_list kept aligned), adding them when
 * missing. No-op when the course has no default trainer or the column does not exist
 * yet. Safe to call inside a transaction (pass the client).
 */
export async function putDefaultTrainerFirst(courseId: string, db: Queryable = pool): Promise<void> {
  const col = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'course' AND column_name = 'default_trainer_id'`
  );
  if (!col.rows.length) return;
  const r = await db.query(
    `SELECT c.trainers_list, c.trainers_email_list, u.full_name, u.email
       FROM course c JOIN app_user u ON u.id = c.default_trainer_id
      WHERE c.id = $1`, [courseId]
  );
  const row = r.rows[0];
  if (!row?.full_name) return;

  const split = (raw: string | null) => {
    const s = String(raw || '').trim();
    if (!s) return [] as string[];
    return (s.includes('|') ? s.split('|') : s.split(',')).map(x => x.trim());
  };
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const names = split(row.trainers_list).filter(Boolean);
  const emailsRaw = split(row.trainers_email_list);
  const aligned = emailsRaw.length === names.length;
  const emails = aligned ? emailsRaw : [];

  const target = norm(row.full_name);
  const idx = names.findIndex(n => norm(n) === target);
  if (idx === 0) return;

  let newNames: string[];
  let newEmails: string[] = emails;
  if (idx > 0) {
    newNames = [names[idx], ...names.filter((_, i) => i !== idx)];
    if (aligned) newEmails = [emails[idx], ...emails.filter((_, i) => i !== idx)];
  } else {
    newNames = [row.full_name, ...names];
    if (aligned) newEmails = [row.email || '', ...emails];
  }

  if (aligned) {
    await db.query(
      `UPDATE course SET trainers_list = $2, trainers_email_list = $3 WHERE id = $1`,
      [courseId, newNames.join(' | '), newEmails.join(' | ')]
    );
  } else {
    await db.query(`UPDATE course SET trainers_list = $2 WHERE id = $1`, [courseId, newNames.join(' | ')]);
  }
}
