import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

// POST { email, fullName, nric?, courseRunId?, courseId?, enrolmentId? }
// Creates a Learner account if one doesn't already exist for that email.
// If courseRunId + courseId are provided, also enrolls the learner into the course run.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { email, fullName, nric, courseRunId, courseId, enrolmentId } = req.body as {
    email: string;
    fullName: string;
    nric?: string;
    courseRunId?: string;
    courseId?: string;
    enrolmentId?: string;
  };

  if (!email || !fullName) {
    return res.status(400).json({ success: false, message: 'email and fullName are required' });
  }

  const client = await pool.connect();

  // Helper: enroll user into a course run if not already enrolled
  const ensureEnrollment = async (userId: string) => {
    if (!courseRunId || !courseId) return;
    await client.query(
      `INSERT INTO enrollment (user_id, course_id, course_run_id, enrolment_date, enrolment_id, nric, email)
       SELECT $1, $2, $3, CURRENT_DATE, $4, $5, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM enrollment WHERE user_id = $1 AND course_run_id = $3
       )`,
      [userId, courseId, courseRunId, enrolmentId || null, nric?.trim() || null, email.trim().toLowerCase()]
    );
  };

  try {
    await client.query('BEGIN');

    // Check if user already exists
    const existing = await client.query(
      'SELECT id, full_name FROM app_user WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const userId = existing.rows[0].id;
      const existingName = existing.rows[0].full_name || fullName.trim();
      // Ensure Learner role is assigned
      await client.query(
        `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
        [userId]
      );
      await ensureEnrollment(userId);
      await client.query('COMMIT');
      return res.status(200).json({
        success: true,
        message: 'Account already exists — Learner role and enrolment ensured.',
        userId,
        fullName: existingName,
        created: false,
      });
    }

    // Create new account with default password
    const passwordHash = await bcrypt.hash('password123', 10);

    const insertUser = await client.query(
      `INSERT INTO app_user (email, full_name, password, password_hash, account_status, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'active', NOW(), NOW())
       RETURNING id`,
      [email.trim().toLowerCase(), fullName.trim(), passwordHash]
    );
    const userId = insertUser.rows[0].id;

    // Create learner_profile (tel required — use empty string as placeholder)
    await client.query(
      `INSERT INTO learner_profile (user_id, tel, nric) VALUES ($1, '', $2)`,
      [userId, nric?.trim() || null]
    );

    // Assign Learner role
    await client.query(
      `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner')`,
      [userId]
    );

    await ensureEnrollment(userId);
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Learner account created and enrolled. Default password: password123`,
      userId,
      fullName: fullName.trim(),
      created: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating learner account:', error);
    return res.status(500).json({ success: false, message: msg });
  } finally {
    client.release();
  }
}
