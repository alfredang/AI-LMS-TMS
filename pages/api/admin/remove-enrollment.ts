import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cancelEnrolmentForLearnerOnRun } from '../../../lib/ssg/mutateEnrolmentForLearner';

// POST { email, courseRunId, force?, cancelOnTpg? }
// Removes a learner from a course run. When cancelOnTpg is true (opt-in, confirm-gated
// in the UI — hits REAL SSG), also cancels their TPGateway enrolment if they have one.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { email, courseRunId, force, cancelOnTpg } = req.body as { email: string; courseRunId: string; force?: boolean; cancelOnTpg?: boolean };

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

    // Guard: refuse to remove if the learner already submitted an assessment for this run.
    // Pass { force: true } to override after a deliberate admin decision.
    if (!force) {
      const submissionGuard = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM link_assessment_submission
              WHERE user_id = $1 AND course_run_id = $2) AS link_count,
           (SELECT COUNT(*)::int FROM submission s
              JOIN enrollment e ON e.id = s.enrollment_id
              WHERE e.user_id = $1 AND e.course_run_id = $2) AS legacy_count`,
        [userId, courseRunId]
      );
      const linkCount = submissionGuard.rows[0]?.link_count ?? 0;
      const legacyCount = submissionGuard.rows[0]?.legacy_count ?? 0;
      if (linkCount + legacyCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          code: 'SUBMISSION_EXISTS',
          message: `Cannot remove — learner has ${linkCount + legacyCount} submitted assessment file(s) for this course run. Pass { force: true } to override.`,
        });
      }
    }

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

    // Opt-in TPGateway cancel (best-effort; never fails the removal). Only when the admin
    // explicitly ticked it AND a row was actually removed. Clears the local enrolment_id on
    // success so a future re-add can re-create on TPG.
    let tpgEnrolment: any = { skipped: true };
    if (cancelOnTpg === true && (result.rowCount ?? 0) > 0) {
      try {
        const r = await cancelEnrolmentForLearnerOnRun(courseRunId, { email });
        if (r.status === 'synced' && r.enrolmentRef) {
          await pool.query(
            `UPDATE enrollment SET enrolment_id = NULL, updated_at = NOW()
              WHERE user_id = $1 AND course_run_id = $2 AND enrolment_id = $3`,
            [userId, courseRunId, r.enrolmentRef]
          );
        }
        tpgEnrolment = { status: r.status, message: r.message };
      } catch (e: any) {
        tpgEnrolment = { status: 'error', message: e?.message || String(e) };
      }
    }

    return res.status(200).json({
      success: true,
      removed: result.rowCount ?? 0,
      tpgEnrolment,
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
