import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureTpgTrainerColumns } from '@/lib/trainerInvitations';
import { autoShareCourseResourcesWithTrainer } from '../../../lib/google-drive/drive-helpers';

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/** Ensure the course_run_trainer junction table exists */
async function ensureJunctionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_run_trainer (
      id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
      trainer_id    UUID,
      trainer_name  TEXT NOT NULL,
      trainer_email TEXT,
      assigned_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
      ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
  `);
}

/** Sync the legacy single-trainer columns on course_run with the first trainer from the junction table */
async function syncLegacyColumns(courseRunUuid: string) {
  const first = await pool.query(
    `SELECT trainer_id, trainer_name, trainer_email
     FROM course_run_trainer
     WHERE course_run_id = $1
     ORDER BY assigned_at ASC
     LIMIT 1`,
    [courseRunUuid]
  );
  if (first.rows.length > 0) {
    const { trainer_id, trainer_name, trainer_email } = first.rows[0];
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW()
       WHERE id = $4`,
      [trainer_id, trainer_name, trainer_email, courseRunUuid]
    );
  } else {
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW()
       WHERE id = $1`,
      [courseRunUuid]
    );
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { courseRunUuid, courseRunId, trainerName, trainerEmail, trainerId } = req.body;

    // Validate required fields
    if (!courseRunUuid || !trainerName) {
      return res.status(400).json({
        success: false,
        error: 'courseRunUuid and trainerName are required'
      });
    }

    console.log('🔄 Updating trainer info for course run UUID:', courseRunUuid);
    console.log('🔄 Course run ID (for reference):', courseRunId);
    console.log('👨‍🏫 Trainer name:', trainerName);
    console.log('📧 Trainer email:', trainerEmail);
    console.log('🆔 Trainer UUID:', trainerId || '(none)');

    // Ensure legacy columns exist on course_run (backward compat)
    for (const col of [
      { name: 'assigned_trainer_name', type: 'TEXT' },
      { name: 'assigned_trainer_email', type: 'TEXT' },
      { name: 'assigned_trainer_id', type: 'UUID' },
    ]) {
      const check = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'course_run' AND column_name = $1`,
        [col.name]
      );
      if (check.rows.length === 0) {
        console.log(`📝 Adding ${col.name} column to course_run table`);
        await pool.query(`ALTER TABLE course_run ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // Ensure junction table
    await ensureJunctionTable();
    await ensureTpgTrainerColumns((sql, params) => pool.query(sql, params));

    // If trainerId is provided, verify it exists in trainer_profile (FK target); create profile if missing
    let resolvedTrainerId = trainerId || null;
    if (resolvedTrainerId) {
      const profileCheck = await pool.query(
        `SELECT user_id FROM trainer_profile WHERE user_id = $1`,
        [resolvedTrainerId]
      );
      if (profileCheck.rows.length === 0) {
        console.log(`⚠️ trainer_profile missing for user ${resolvedTrainerId} — creating it`);
        await pool.query(
          `INSERT INTO trainer_profile (user_id, tel, trainer_type, status)
           VALUES ($1, '', 'non-ACLP', 'Active')
           ON CONFLICT (user_id) DO NOTHING`,
          [resolvedTrainerId]
        );
      }
    }

    if (!resolvedTrainerId && trainerEmail) {
      const emailLower = trainerEmail.trim().toLowerCase();
      const trainerLookup = await pool.query(
        `SELECT au.id FROM app_user au
         JOIN trainer_profile tp ON tp.user_id = au.id
         WHERE LOWER(au.email) = $1 OR LOWER(au.secondary_email) = $1
         LIMIT 1`,
        [emailLower]
      );
      if (trainerLookup.rows.length > 0) {
        resolvedTrainerId = trainerLookup.rows[0].id;
        console.log(`🔍 Resolved trainer ID from email (${trainerEmail}): ${resolvedTrainerId}`);
      } else {
        // Auto-create app_user + trainer_profile for this trainer
        console.log(`➕ Trainer not found — creating app_user + trainer_profile for ${trainerEmail}`);
        const newUser = await pool.query(
          `INSERT INTO app_user (email, full_name, account_status)
           VALUES ($1, $2, 'active')
           ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
           RETURNING id`,
          [trainerEmail.trim(), trainerName.trim()]
        );
        const newUserId = newUser.rows[0].id;
        await pool.query(
          `INSERT INTO trainer_profile (user_id, tel, trainer_type, status)
           VALUES ($1, '', 'non-ACLP', 'Active')
           ON CONFLICT (user_id) DO NOTHING`,
          [newUserId]
        );
        resolvedTrainerId = newUserId;
        console.log(`✅ Created trainer account: ${trainerEmail} (${newUserId})`);
      }
    }

    // ── Backfill: migrate existing legacy trainer into junction table if not already there ──
    const legacyTrainer = await pool.query(
      `SELECT assigned_trainer_id, assigned_trainer_name, assigned_trainer_email, tpg_assigned_trainer_name
       FROM course_run WHERE id = $1`,
      [courseRunUuid]
    );
    if (legacyTrainer.rows.length > 0 && legacyTrainer.rows[0].assigned_trainer_name && !legacyTrainer.rows[0].tpg_assigned_trainer_name) {
      const lt = legacyTrainer.rows[0];
      await pool.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
         DO NOTHING`,
        [courseRunUuid, lt.assigned_trainer_id || null, lt.assigned_trainer_name, lt.assigned_trainer_email || null]
      );
    }

    // ── INSERT into junction table (additive — does NOT replace existing trainers) ──
    await pool.query(
      `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
       DO UPDATE SET trainer_name = EXCLUDED.trainer_name, trainer_email = EXCLUDED.trainer_email`,
      [courseRunUuid, resolvedTrainerId, trainerName, trainerEmail || null]
    );

    // Sync legacy columns so backward-compat code keeps working
    await syncLegacyColumns(courseRunUuid);

    // Auto-confirm the class: if this run was still 'Pending' (no trainer yet),
    // flip to 'Confirmed' now that a trainer is assigned. Never touch
    // 'Cancelled' or already-'Confirmed' rows — this is one-directional.
    await pool.query(
      `UPDATE course_run
       SET class_status = 'Confirmed', updated_at = NOW()
       WHERE id = $1 AND class_status = 'Pending'`,
      [courseRunUuid]
    );

    // ── Auto-share Google Drive folders (courseware + trainer slides) ──
    if (trainerEmail) {
      // We need course_id to lookup the drive links
      const crResult = await pool.query(`SELECT course_id FROM course_run WHERE id = $1`, [courseRunUuid]);
      if (crResult.rows.length > 0) {
        const courseId = crResult.rows[0].course_id;
        autoShareCourseResourcesWithTrainer(courseId, trainerEmail).catch(err => {
          console.warn(`⚠️ Non-blocking auto-share error for ${trainerEmail} in local assign:`, err.message);
        });
      }
    }

    console.log('✅ Successfully added trainer to course run (multi-trainer)');

    res.status(200).json({
      success: true,
      message: 'Trainer information updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating trainer information:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}
