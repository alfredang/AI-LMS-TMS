import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseId, learnerEmail } = req.body;

    if (!courseId || !learnerEmail) {
      return res.status(400).json({ message: 'Course ID and learner email are required' });
    }

    // Get learner ID
    const learnerResult = await pool.query(
      'SELECT id AS user_id FROM public.app_user WHERE email = $1',
      [learnerEmail]
    );

    if (learnerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Learner not found' });
    }

    const learnerId = learnerResult.rows[0].user_id;

    // Remove enrollment
    const result = await pool.query(
      'DELETE FROM enrolments WHERE course_id = $1 AND learner_id = $2',
      [courseId, learnerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Learner unenrolled successfully'
    });
  } catch (error) {
    console.error('Error unenrolling learner:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}