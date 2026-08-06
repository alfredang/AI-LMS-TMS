import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { addTrainerToCalendar } from '../../../lib/calendar/addTrainerToCalendar';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId, trainerEmail } = req.body;

  if (!courseRunId || !trainerEmail) {
    return res.status(400).json({ success: false, error: 'Missing courseRunId or trainerEmail' });
  }

  try {
    const result = await addTrainerToCalendar(courseRunId, trainerEmail);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ [api/admin/add-trainer-to-calendar] error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
