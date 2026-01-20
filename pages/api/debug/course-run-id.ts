import { NextApiRequest, NextApiResponse } from 'next';

interface ApiResponse {
  success: boolean;
  courseRunId?: string;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  
  return res.status(200).json({
    success: true,
    courseRunId: courseRunId as string,
  });
}