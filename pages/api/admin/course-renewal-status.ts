import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { RENEW_STATUS_VALUES } from '@lib/courseRenewalStatus';
import { recordCourseChanges } from '../../../lib/courseChangeLog';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { courseId, renew, status } = req.body ?? {};

  if (!courseId) {
    return res.status(400).json({ success: false, message: 'courseId is required' });
  }

  // `status` is the dropdown ('' / null clears the column); `renew` is the
  // old boolean tick, still accepted so nothing that predates the dropdown
  // breaks.
  let nextStatus: string | null;
  if (status !== undefined) {
    const trimmed = String(status ?? '').trim();
    if (trimmed && !RENEW_STATUS_VALUES.includes(trimmed)) {
      return res.status(400).json({ success: false, message: `Unknown renewal status "${trimmed}"` });
    }
    nextStatus = trimmed || null;
  } else if (typeof renew === 'boolean') {
    nextStatus = renew ? 'To Renew' : null;
  } else {
    return res.status(400).json({ success: false, message: 'Either status or renew is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Course Change Control entry, so a renewal status can always be traced back
    // to what it was and who changed it — the bulk tool on the Funding Validity
    // page can rewrite hundreds of rows in one action, and without this the
    // previous values would be unrecoverable. Runs BEFORE the UPDATE because
    // recordCourseChanges reads the pre-update value for the "from" side.
    // Best-effort, same as update-course-validity: an audit failure must never
    // cost the caller their edit.
    try {
      await client.query('SAVEPOINT before_change_log');
      const authUser = (req as any).authUser;
      await recordCourseChanges(
        client,
        courseId,
        { renewedStatus: nextStatus },
        authUser?.isService ? { userName: 'System' } : { userId: authUser?.id || null },
      );
      await client.query('RELEASE SAVEPOINT before_change_log');
    } catch (logError) {
      await client.query('ROLLBACK TO SAVEPOINT before_change_log');
      console.error('Course change log skipped:', (logError as Error).message);
    }

    const result = await client.query(
      `
        UPDATE course
        SET renewed_status = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, renewed_status
      `,
      [courseId, nextStatus]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      data: {
        id: result.rows[0].id,
        renewedStatus: result.rows[0].renewed_status,
      },
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already gone — nothing to roll back
    }
    console.error('❌ course-renewal-status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update course renewal status',
      error: error.message,
    });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
