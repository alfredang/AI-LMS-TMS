import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// DELETE { nric, sessionId }
// Removes a learner's attendance record for the specified session only.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { nric, sessionId } = req.body as { nric: string; sessionId: string };
  if (!nric || !sessionId) {
    return res.status(400).json({ success: false, error: 'nric and sessionId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM course_attendance WHERE session_id = $1 AND nric = $2`,
      [sessionId, nric]
    );
    return res.status(200).json({ success: true, message: 'Attendance record removed.' });
  } catch (err) {
    console.error('Error removing attendance record:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
