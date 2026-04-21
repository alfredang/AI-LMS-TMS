import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { courseId, whitelist } = req.body ?? {};

    if (!courseId || typeof whitelist !== 'boolean') {
      return res.status(400).json({ success: false, message: 'courseId and whitelist are required' });
    }

    const result = await pool.query(
      `UPDATE course
       SET whitelist_status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, whitelist_status`,
      [courseId, whitelist ? 'Whitelisted' : null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: result.rows[0].id,
        whitelistStatus: result.rows[0].whitelist_status,
      },
    });
  } catch (error: any) {
    console.error('❌ course-whitelist-status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update whitelist status',
      error: error.message,
    });
  }
}
