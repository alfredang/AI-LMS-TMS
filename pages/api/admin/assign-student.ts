import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { triggerProformaGeneration } from '../../../lib/services/proformaInvoiceService';
import { triggerClassCalendarSync } from '@lib/calendar/triggerClassCalendarSync';
import { autoShareLearnerMaterials } from '@lib/google-drive/drive-helpers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid, userId, manualName, manualEmail } = req.body;

  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  // Either userId (dropdown) or manualName+manualEmail (manual) must be provided
  if (!userId && !manualName) {
    return res.status(400).json({ success: false, error: 'userId or manualName is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tp = await getTrainingPartnerIdentifiers();

    // Fetch the course_id for this course run
    const runResult = await client.query(
      `SELECT id, course_id FROM course_run WHERE id = $1`,
      [courseRunUuid]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    const { course_id: courseId } = runResult.rows[0];

    let resolvedUserId = userId;
    let userEmail = manualEmail || null;
    let userNric = '';
    let enrollmentRestored = false;

    if (userId) {
      // Dropdown mode: look up user info
      const existing = await client.query(
        `SELECT id, enrolment_status FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
        [userId, courseRunUuid]
      );
      if (existing.rows.length > 0) {
        const existingStatus = existing.rows[0].enrolment_status;
        if (existingStatus === 'Admin Removed' || !existingStatus) {
          // Re-activate the soft-deleted or ghost (NULL status) enrollment
          await client.query(
            `UPDATE enrollment SET enrolment_status = 'Confirmed', updated_at = NOW() WHERE id = $1`,
            [existing.rows[0].id]
          );
          enrollmentRestored = true;
        } else {
          return res.status(409).json({ success: false, error: 'Student is already enrolled in this course run' });
        }
      }

      const userInfoResult = await client.query(
        `SELECT au.email, COALESCE(lp.nric, '') AS nric
         FROM app_user au
         LEFT JOIN learner_profile lp ON lp.user_id = au.id
         WHERE au.id = $1`,
        [userId]
      );
      const info = userInfoResult.rows[0] ?? {};
      userEmail = info.email;
      userNric = info.nric;
    } else {
      // Manual mode: find or create user by email, or create without email
      if (manualEmail) {
        // Match against primary OR secondary email, case-insensitively
        const existingUser = await client.query(
          `SELECT id FROM app_user
           WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1)
           LIMIT 1`,
          [manualEmail]
        );
        if (existingUser.rows.length > 0) {
          // Account already exists — ensure it's active, then assign to class
          resolvedUserId = existingUser.rows[0].id;
          await client.query(
            `UPDATE app_user SET account_status = 'active', updated_at = NOW() WHERE id = $1 AND account_status != 'active'`,
            [resolvedUserId]
          );
          const existingEnroll = await client.query(
            `SELECT id, enrolment_status FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
            [resolvedUserId, courseRunUuid]
          );
          if (existingEnroll.rows.length > 0) {
            const existingStatus = existingEnroll.rows[0].enrolment_status;
            if (existingStatus === 'Admin Removed' || !existingStatus) {
              // Re-activate the soft-deleted or ghost (NULL status) enrollment
              await client.query(
                `UPDATE enrollment SET enrolment_status = 'Confirmed', updated_at = NOW() WHERE id = $1`,
                [existingEnroll.rows[0].id]
              );
              enrollmentRestored = true;
            } else {
              return res.status(409).json({ success: false, error: 'Student is already enrolled in this course run' });
            }
          }
        } else {
          // Create app_user with default password
          const passwordHash = await bcrypt.hash(tp.defaultPassword, 10);
          const newUser = await client.query(
            `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW(), NOW())
             RETURNING id`,
            [manualEmail.toLowerCase(), manualName, passwordHash]
          );
          resolvedUserId = newUser.rows[0].id;
          // Assign Learner role via user_role_map
          await client.query(
            `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
            [resolvedUserId]
          );
          // Create learner_profile (user_id is PK, tel required — default empty)
          await client.query(
            `INSERT INTO learner_profile (user_id, tel) VALUES ($1, '') ON CONFLICT (user_id) DO NOTHING`,
            [resolvedUserId]
          );
        }
      } else {
        // No email — generate placeholder and create account
        const placeholderEmail = manualName.toLowerCase().replace(/\s+/g, '.') + '@manual.entry';
        const passwordHash = await bcrypt.hash(tp.defaultPassword, 10);
        const newUser = await client.query(
          `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW(), NOW())
           RETURNING id`,
          [placeholderEmail, manualName, passwordHash]
        );
        resolvedUserId = newUser.rows[0].id;
        await client.query(
          `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
          [resolvedUserId]
        );
        await client.query(
          `INSERT INTO learner_profile (user_id, tel) VALUES ($1, '') ON CONFLICT (user_id) DO NOTHING`,
          [resolvedUserId]
        );
      }
    }

    // Create enrollment (skip if we just restored an Admin Removed row)
    let newEnrollmentId: string | null = null;
    if (!enrollmentRestored) {
      const inserted = await client.query(
        `INSERT INTO enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, enrolment_status, enrolment_date, email, nric, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', 'Confirmed', CURRENT_DATE, $4, $5, NOW(), NOW())
         RETURNING id`,
        [resolvedUserId, courseId, courseRunUuid, userEmail || null, userNric || null]
      );
      newEnrollmentId = inserted.rows[0]?.id ?? null;
    }

    // Add learner to all existing sessions for manual attendance tracking
    // Use NRIC if available, otherwise _uid_<userId> as identifier (matches handleAddManualLearner pattern)
    const identifier = userNric || `_uid_${resolvedUserId}`;
    const sessionsResult = await client.query(
      `SELECT id FROM course_session WHERE course_run_id = $1`,
      [courseRunUuid]
    );
    for (const session of sessionsResult.rows) {
      await client.query(
        `INSERT INTO course_attendance (session_id, nric, user_id, is_present, reason_of_absence, updated_at)
         VALUES ($1, $2, $3, false, null, NOW())
         ON CONFLICT (session_id, nric) DO NOTHING`,
        [session.id, identifier, resolvedUserId]
      );
    }

    await client.query('COMMIT');

    if (newEnrollmentId) {
      triggerProformaGeneration(newEnrollmentId);
    }
    // Calendar: a new/restored confirmed learner -> ensure the event + add them.
    // OPT-IN ONLY: the admin must explicitly confirm the Google Calendar update
    // (UI sends syncCalendar:true after a confirmation step) — never silent.
    if (req.body?.syncCalendar === true) triggerClassCalendarSync(courseRunUuid);

    // Grant this learner Viewer access to the course's learner materials (slides / guide / lesson plan)
    // so the Google links open without "request access". Idempotent + non-blocking; skips placeholder
    // (manual, no-email) accounts which aren't Google accounts.
    if (userEmail && !userEmail.toLowerCase().endsWith('@manual.entry')) {
      try {
        const shared = await autoShareLearnerMaterials(courseRunUuid, [userEmail]);
        console.log(`[assign-student] shared ${shared.files} material(s) with ${userEmail} (${shared.grants} grants)`);
      } catch (e) {
        console.warn('[assign-student] learner material share failed (non-blocking):', e instanceof Error ? e.message : e);
      }
    }

    res.status(200).json({ success: true, message: enrollmentRestored ? 'Student re-enrolled successfully' : 'Student enrolled successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error assigning student:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}
