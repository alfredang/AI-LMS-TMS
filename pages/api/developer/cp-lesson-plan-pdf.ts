import { withAuth } from '@lib/auth/withAuth';
/**
 * CP Generator — Lesson Plan .pdf download.
 *
 * Renders the same HTML used for the on-screen layout (see
 * lib/cp-lesson-plan-doc.ts) via the hardened Playwright launcher and
 * returns the PDF buffer. CP-only — does not share code paths with the CW
 * Generator's lesson plan flow.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { generateLessonPlanHtml } from '../../../lib/cp-lesson-plan-doc';
import { launchHardenedChromium } from '../../../lib/chromium-launch';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

function safeFilename(s: string): string {
  return (s || 'lesson_plan')
    .replace(/[^A-Za-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'lesson_plan';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      text,
      courseTitle = '',
      courseDuration = 0,
      instructionalHours = 0,
      assessmentHours = 0,
      instructionalMethods = [],
    } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Lesson plan text is required. Generate the lesson plan first.' });
    }

    const html = generateLessonPlanHtml(text, {
      courseTitle: String(courseTitle),
      courseDurationHours: Number(courseDuration) || 0,
      instructionalHours: Number(instructionalHours) || 0,
      assessmentHours: Number(assessmentHours) || 0,
      instructionalMethods: Array.isArray(instructionalMethods) ? instructionalMethods.map(String) : [],
    });

    const browser = await launchHardenedChromium();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
      });

      const filename = `${safeFilename(courseTitle)}_Lesson_Plan.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(pdf.length));
      return res.status(200).send(pdf);
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    console.error('[cp-lesson-plan-pdf] error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate lesson plan .pdf' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
