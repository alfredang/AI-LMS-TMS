import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { courseId, renew } = req.body ?? {};

    if (!courseId || typeof renew !== 'boolean') {
      return res.status(400).json({ success: false, message: 'courseId and renew are required' });
    }

    const result = await pool.query(
      `
        UPDATE course
        SET renewed_status = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, renewed_status
      `,
      [courseId, renew ? 'To Renew' : null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: result.rows[0].id,
        renewedStatus: result.rows[0].renewed_status,
      },
    });
  } catch (error: any) {
    console.error('❌ course-renewal-status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update course renewal status',
      error: error.message,
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
