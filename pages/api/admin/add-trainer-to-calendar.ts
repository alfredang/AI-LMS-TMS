import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { addTrainerToCalendar } from '../../../lib/calendar/addTrainerToCalendar';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user.role !== 'Admin') {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
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
