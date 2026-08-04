import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateBrochure } from '../../../lib/cw-brochure';
import path from 'path';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: '50mb',
  },
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 80).trim();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseUrl } = req.body || {};
  if (!courseUrl || !/^https?:\/\//i.test(courseUrl)) {
    return res.status(400).json({ error: 'A valid http(s) course URL is required.' });
  }

  // Pure-Node implementation — scrapes via cheerio, renders via the npm
  // `playwright` package. No Python dependency, so Coolify deploys without
  // python3 on PATH still produce brochures successfully.
  try {
    const templateDir = path.join(process.cwd(), 'public', 'templates', 'brochure');
    const { data, pdfBuffer } = await generateBrochure(courseUrl, templateDir);
    const title = sanitizeFileName(data.course_title || 'Brochure');
    const fileName = `Brochure_${data.tgs_reference_no || 'course'}_${title}.pdf`;

    return res.status(200).json({
      success: true,
      courseTitle: data.course_title,
      tgsRef: data.tgs_reference_no,
      courseData: {
        tsc_code: data.tsc_code,
        tsc_title: data.tsc_title,
        tsc_framework: data.tsc_framework,
        duration_hrs: data.duration_hrs,
        session_days: data.session_days,
        gst_exclusive_price: data.gst_exclusive_price,
        gst_inclusive_price: data.gst_inclusive_price,
        num_topics: data.course_details_topics.length,
        num_outcomes: data.learning_outcomes.length,
      },
      document: {
        name: fileName,
        data: pdfBuffer.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('Brochure generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate brochure' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
