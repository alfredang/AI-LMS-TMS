import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid } = req.body;
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE course_run
       SET assigned_trainer_name = NULL,
           assigned_trainer_email = NULL,
           assigned_trainer_id = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [courseRunUuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    return res.status(200).json({ success: true, message: 'Trainer removed successfully' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}
