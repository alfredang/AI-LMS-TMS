import type { NextApiRequest, NextApiResponse } from 'next';
import { generateBrochure } from '../../../lib/cw-brochure';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: '50mb',
  },
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 80).trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseUrl } = req.body || {};
  if (!courseUrl || !/^https?:\/\//i.test(courseUrl)) {
    return res.status(400).json({ error: 'A valid http(s) course URL is required.' });
  }

  try {
    const result = await generateBrochure(courseUrl);
    const title = sanitizeFileName(result.courseTitle || 'Brochure');
    const fileName = `Brochure_${result.tgsRef || 'course'}_${title}.pdf`;
    return res.status(200).json({
      success: true,
      courseTitle: result.courseTitle,
      tgsRef: result.tgsRef,
      courseData: result.courseData,
      document: {
        name: fileName,
        data: result.buffer.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('Brochure generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate brochure' });
  }
}
