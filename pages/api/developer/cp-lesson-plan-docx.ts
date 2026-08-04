import { withAuth } from '@lib/auth/withAuth';
/**
 * CP Generator — Lesson Plan .docx download.
 *
 * POST { text, courseTitle, courseDuration, instructionalHours,
 *        assessmentHours, instructionalMethods: string[] }
 *
 * Returns a .docx blob (Streamlit-parity layout). Distinct from the CW
 * Generator's lesson plan endpoint — different output format, different code
 * path. See lib/cp-lesson-plan-doc.ts for the builder.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { generateLessonPlanDocx } from '../../../lib/cp-lesson-plan-doc';

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

    const buffer = generateLessonPlanDocx(text, {
      courseTitle: String(courseTitle),
      courseDurationHours: Number(courseDuration) || 0,
      instructionalHours: Number(instructionalHours) || 0,
      assessmentHours: Number(assessmentHours) || 0,
      instructionalMethods: Array.isArray(instructionalMethods) ? instructionalMethods.map(String) : [],
    });

    const filename = `${safeFilename(courseTitle)}_Lesson_Plan.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).send(buffer);
  } catch (err: any) {
    console.error('[cp-lesson-plan-docx] error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate lesson plan .docx' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
