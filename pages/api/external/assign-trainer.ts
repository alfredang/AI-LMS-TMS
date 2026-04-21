import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Assign Trainer to Course Run
 *
 * POST /api/external/assign-trainer
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body (JSON):
 *   {
 *     "course_run_id": "1334264",
 *     "trainer_email": "angch@tertiaryinfotech.com",
 *     "trainer_name": "Dr. Alfred Ang"  (optional — resolved from app_user if omitted)
 *   }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS headers for external callers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { course_run_id, trainer_email, trainer_name } = req.body ?? {};

  if (!course_run_id) {
    return res.status(400).json({ success: false, error: 'Missing required field: course_run_id' });
  }
  if (!trainer_email) {
    return res.status(400).json({ success: false, error: 'Missing required field: trainer_email' });
  }

  try {
    // Look up the course run by SSG course_run_id
    const crResult = await pool.query(
      `SELECT id, course_run_id FROM course_run WHERE course_run_id = $1`,
      [String(course_run_id)]
    );
    if (crResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Course run ${course_run_id} not found` });
    }
    const courseRunUuid = crResult.rows[0].id;

    // Resolve trainer from app_user + trainer_profile
    const emailLower = trainer_email.trim().toLowerCase();
    let resolvedTrainerId: string | null = null;
    let resolvedTrainerName: string = trainer_name || '';

    const trainerLookup = await pool.query(
      `SELECT au.id, au.full_name FROM app_user au
       JOIN trainer_profile tp ON tp.user_id = au.id
       WHERE LOWER(au.email) = $1 OR LOWER(au.secondary_email) = $1
       LIMIT 1`,
      [emailLower]
    );

    if (trainerLookup.rows.length > 0) {
      resolvedTrainerId = trainerLookup.rows[0].id;
      if (!resolvedTrainerName) {
        resolvedTrainerName = trainerLookup.rows[0].full_name;
      }
    } else if (!resolvedTrainerName) {
      return res.status(404).json({
        success: false,
        error: `Trainer with email ${trainer_email} not found. Provide trainer_name to auto-create.`,
      });
    }

    // Auto-create trainer if not found but name is provided
    if (!resolvedTrainerId && resolvedTrainerName) {
      const newUser = await pool.query(
        `INSERT INTO app_user (email, full_name, account_status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [trainer_email.trim(), resolvedTrainerName.trim()]
      );
      resolvedTrainerId = newUser.rows[0].id;
      await pool.query(
        `INSERT INTO trainer_profile (user_id, tel, trainer_type, status)
         VALUES ($1, '', 'non-ACLP', 'Active')
         ON CONFLICT (user_id) DO NOTHING`,
        [resolvedTrainerId]
      );
    }

    // Remove existing trainers from junction table for this course run (full reassignment)
    await pool.query(
      `DELETE FROM course_run_trainer WHERE course_run_id = $1`,
      [courseRunUuid]
    );

    // Insert new trainer into junction table
    await pool.query(
      `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
       VALUES ($1, $2, $3, $4)`,
      [courseRunUuid, resolvedTrainerId, resolvedTrainerName, trainer_email.trim()]
    );

    // Update legacy columns on course_run
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = $1,
           assigned_trainer_name = $2,
           assigned_trainer_email = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [resolvedTrainerId, resolvedTrainerName, trainer_email.trim(), courseRunUuid]
    );

    // Auto-confirm if pending
    await pool.query(
      `UPDATE course_run
       SET class_status = 'Confirmed', updated_at = NOW()
       WHERE id = $1 AND class_status = 'Pending'`,
      [courseRunUuid]
    );

    return res.status(200).json({
      success: true,
      message: `Trainer ${resolvedTrainerName} (${trainer_email}) assigned to course run ${course_run_id}`,
      data: {
        course_run_id,
        course_run_uuid: courseRunUuid,
        trainer_id: resolvedTrainerId,
        trainer_name: resolvedTrainerName,
        trainer_email: trainer_email.trim(),
      },
    });
  } catch (error) {
    console.error('assign-trainer error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
