import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

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

    if (userId) {
      // Dropdown mode: look up user info
      const existing = await client.query(
        `SELECT id FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
        [userId, courseRunUuid]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: 'Student is already enrolled in this course run' });
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
        const existingUser = await client.query(
          `SELECT id FROM app_user WHERE email = $1`,
          [manualEmail]
        );
        if (existingUser.rows.length > 0) {
          resolvedUserId = existingUser.rows[0].id;
          // Check duplicate enrollment
          const existingEnroll = await client.query(
            `SELECT id FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
            [resolvedUserId, courseRunUuid]
          );
          if (existingEnroll.rows.length > 0) {
            return res.status(409).json({ success: false, error: 'Student is already enrolled in this course run' });
          }
        } else {
          // Create new user with learner role
          const newUser = await client.query(
            `INSERT INTO app_user (id, email, full_name, role, account_status, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, 'Learner', 'Active', NOW(), NOW())
             RETURNING id`,
            [manualEmail, manualName]
          );
          resolvedUserId = newUser.rows[0].id;
          // Create learner profile
          await client.query(
            `INSERT INTO learner_profile (id, user_id, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [resolvedUserId]
          );
        }
      } else {
        // No email provided — create user with just name
        const newUser = await client.query(
          `INSERT INTO app_user (id, email, full_name, role, account_status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'Learner', 'Active', NOW(), NOW())
           RETURNING id`,
          [manualName.toLowerCase().replace(/\s+/g, '.') + '@manual.entry', manualName]
        );
        resolvedUserId = newUser.rows[0].id;
        await client.query(
          `INSERT INTO learner_profile (id, user_id, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [resolvedUserId]
        );
      }
    }

    // Create enrollment
    await client.query(
      `INSERT INTO enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, enrolment_date, email, nric, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', CURRENT_DATE, $4, $5, NOW(), NOW())`,
      [resolvedUserId, courseId, courseRunUuid, userEmail || null, userNric || null]
    );

    res.status(200).json({ success: true, message: 'Student enrolled successfully' });
  } catch (error) {
    console.error('Error assigning student:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
