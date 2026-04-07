import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/rename-trainer
 * Renames a trainer by email across all tables: app_user, course_run_trainer, course_run.
 * Body: { email: string, newName: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { action } = req.body ?? {};

  // Action: set-approved-trainers — set the full trainers_list for a course
  if (action === 'set-approved-trainers') {
    const { courseCode, trainersList } = req.body;
    if (!courseCode || !trainersList) {
      return res.status(400).json({ success: false, error: 'courseCode and trainersList are required' });
    }
    try {
      const result = await pool.query(
        `UPDATE course SET trainers_list = $1 WHERE course_code = $2 RETURNING id, title, trainers_list`,
        [trainersList, courseCode]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Course not found' });
      }
      return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error('Error setting approved trainers:', error);
      return res.status(500).json({ success: false, error: 'Failed to set trainers' });
    }
  }

  // Action: update-nric — update a trainer's NRIC
  if (action === 'update-nric') {
    const { userId, nric } = req.body;
    if (!userId || !nric) {
      return res.status(400).json({ success: false, error: 'userId and nric are required' });
    }
    try {
      await pool.query(`UPDATE trainer_profile SET nric = $1 WHERE user_id = $2`, [nric, userId]);
      return res.status(200).json({ success: true, message: 'NRIC updated' });
    } catch (error) {
      console.error('Error updating NRIC:', error);
      return res.status(500).json({ success: false, error: 'Failed to update NRIC' });
    }
  }

  // Action: update-tpg-trainer — manually set TPG trainer info on a course run
  if (action === 'update-tpg-trainer') {
    const { courseRunId, trainerName, trainerEmail } = req.body;
    if (!courseRunId || !trainerName) {
      return res.status(400).json({ success: false, error: 'courseRunId and trainerName are required' });
    }
    try {
      const result = await pool.query(
        `UPDATE course_run SET tpg_assigned_trainer_name = $1, tpg_assigned_trainer_email = $2 WHERE course_run_id = $3 RETURNING id`,
        [trainerName, trainerEmail || null, courseRunId]
      );
      return res.status(200).json({ success: true, rowCount: result.rowCount });
    } catch (error) {
      console.error('Error updating TPG trainer:', error);
      return res.status(500).json({ success: false, error: 'Failed to update TPG trainer' });
    }
  }

  // Default action: rename trainer by email
  const { email, newName } = req.body ?? {};
  if (!email || !newName) {
    return res.status(400).json({ success: false, error: 'email and newName are required' });
  }

  try {
    const results: string[] = [];

    // 1. Update app_user.full_name
    const r1 = await pool.query(
      `UPDATE app_user SET full_name = $1 WHERE LOWER(email) = LOWER($2) RETURNING id, full_name`,
      [newName, email]
    );
    results.push(`app_user: ${r1.rowCount} row(s) updated`);

    // 2. Update course_run_trainer.trainer_name
    const r2 = await pool.query(
      `UPDATE course_run_trainer SET trainer_name = $1 WHERE LOWER(trainer_email) = LOWER($2)`,
      [newName, email]
    );
    results.push(`course_run_trainer: ${r2.rowCount} row(s) updated`);

    // 3. Update course_run.assigned_trainer_name (legacy column)
    const r3 = await pool.query(
      `UPDATE course_run SET assigned_trainer_name = $1 WHERE LOWER(assigned_trainer_email) = LOWER($2)`,
      [newName, email]
    );
    results.push(`course_run.assigned_trainer_name: ${r3.rowCount} row(s) updated`);

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('Error renaming trainer:', error);
    return res.status(500).json({ success: false, error: 'Failed to rename trainer' });
  }
}
