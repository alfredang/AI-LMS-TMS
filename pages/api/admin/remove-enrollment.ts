import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// POST { email, courseRunId }
// Removes a learner from a course run.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { email, courseRunId } = req.body as { email: string; courseRunId: string };

  if (!email || !courseRunId) {
    return res.status(400).json({ success: false, message: 'email and courseRunId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find user by email
    const userResult = await client.query(
      `SELECT id FROM app_user WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      await client.query('COMMIT');
      return res.status(200).json({ success: true, message: 'No account found, nothing to remove.' });
    }

    const userId = userResult.rows[0].id;

    // Soft-delete: mark as Admin Removed so SSG sync does not re-add the learner
    const result = await client.query(
      `UPDATE enrollment
       SET enrolment_status = 'Admin Removed', updated_at = NOW()
       WHERE user_id = $1 AND course_run_id = $2`,
      [userId, courseRunId]
    );

    // Signal learner to refresh
    await client.query(
      `UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      removed: result.rowCount ?? 0,
      message: result.rowCount ? 'Learner removed from course run.' : 'Learner was not enrolled — nothing to remove.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error removing enrollment:', error);
    return res.status(500).json({ success: false, message: msg });
  } finally {
    client.release();
  }
}
