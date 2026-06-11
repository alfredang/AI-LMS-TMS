import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createClassCalendarEvent } from '../../../lib/google-calendar/da-calendar-sync';

/**
 * POST /api/admin/reschedule-class
 *
 * Reschedules a class from the admin Upcoming Classes page:
 *   - Moves the course_run start date to `newStartDate`; the end date auto-shifts
 *     to preserve the original class duration.
 *   - REPLACES the class's trainer with the selected one (clears the
 *     course_run_trainer junction + sets the legacy assigned_trainer_* columns).
 *   - Creates a NEW Google Calendar event on the new start date (the OLD event is
 *     intentionally left in place — we do NOT remove it). Calendar step is
 *     best-effort / non-fatal.
 *
 * Body: { id: string (course_run UUID), newStartDate: 'YYYY-MM-DD', trainerName?: string }
 *
 * v1 scope: course_session per-day rows are NOT shifted (no cascade exists); the
 * new calendar event is anchored on the new start date only.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { id, newStartDate, trainerName } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id (course_run uuid) is required' });
  if (!newStartDate || !DATE_RE.test(newStartDate)) {
    return res.status(400).json({ success: false, error: 'newStartDate (YYYY-MM-DD) is required' });
  }

  const client = await pool.connect();
  try {
    // 1. Load the run + course.
    const runRes = await client.query(
      `SELECT cr.id, cr.course_run_id, c.title AS course_title,
              cr.start_date::date AS start_date, cr.end_date::date AS end_date,
              cr.assigned_trainer_name, cr.assigned_trainer_email
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id = $1 LIMIT 1`,
      [id]
    );
    if (runRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Course run not found' });
    const run = runRes.rows[0];

    // 2. New end date = new start + original duration (whole days, DST-safe in SQL).
    let newEnd: string = newStartDate;
    if (run.end_date) {
      const calc = await client.query(
        `SELECT to_char(($1::date + ($3::date - $2::date)), 'YYYY-MM-DD') AS new_end`,
        [newStartDate, run.start_date, run.end_date]
      );
      newEnd = calc.rows[0].new_end;
    }

    // 3. Resolve the selected trainer (REPLACE). If no name supplied, keep existing.
    let trainer = { id: null as string | null, name: run.assigned_trainer_name as string | null, email: run.assigned_trainer_email as string | null };
    let replaceTrainer = false;
    if (trainerName && String(trainerName).trim()) {
      const tRes = await client.query(
        `SELECT au.id, au.email, au.full_name
           FROM app_user au JOIN trainer_profile tp ON tp.user_id = au.id
          WHERE au.full_name = $1 LIMIT 1`,
        [String(trainerName).trim()]
      );
      if (tRes.rowCount === 0) {
        return res.status(404).json({ success: false, error: `Trainer "${trainerName}" not found` });
      }
      trainer = { id: tRes.rows[0].id, name: tRes.rows[0].full_name, email: tRes.rows[0].email };
      replaceTrainer = true;
    }

    // 4. Transaction: shift dates + replace trainer.
    await client.query('BEGIN');
    await client.query(
      `UPDATE course_run SET start_date = $1, end_date = $2, updated_at = NOW() WHERE id = $3`,
      [newStartDate, newEnd, id]
    );
    if (replaceTrainer) {
      await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [id]);
      await client.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
         VALUES ($1, $2, $3, $4)`,
        [id, trainer.id, trainer.name, trainer.email]
      );
      await client.query(
        `UPDATE course_run
            SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW()
          WHERE id = $4`,
        [trainer.id, trainer.name, trainer.email, id]
      );
    }
    await client.query('COMMIT');

    // 5. Create the NEW calendar event on the new date (leave the old one). Non-fatal.
    let calendar = { created: false, message: '' };
    try {
      const calRes = await createClassCalendarEvent(id, { trainerEmail: trainer.email, forceCreate: false });
      calendar = { created: calRes.created, message: calRes.message };
    } catch (calErr: any) {
      calendar = { created: false, message: calErr?.message || 'calendar error' };
    }

    return res.status(200).json({
      success: true,
      data: {
        id,
        startDate: newStartDate,
        endDate: newEnd,
        assignedTrainerLocal: trainer.name || '',
        assignedTrainerLocalEmail: trainer.email || '',
        calendar,
      },
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('❌ [reschedule-class]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to reschedule' });
  } finally {
    client.release();
  }
}
