import type { NextApiRequest, NextApiResponse } from 'next';
import { createZoomMeetingForCourseRun } from '../../../lib/virtual-meetings/zoom-meeting-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunId, provider, force } = req.body || {};
  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  if (provider && provider !== 'zoom') {
    return res.status(400).json({ success: false, error: 'Only Zoom meeting generation is implemented by this endpoint.' });
  }

  try {
    const result = await createZoomMeetingForCourseRun(courseRunId, { force: !!force });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Failed to create virtual meeting' });
  }
}
