import { withAuth } from '@lib/auth/withAuth';
/**
 * POST /api/admin/microsoft-redeem/generate
 *
 * Body: { courseNumber: string, count?: number, students?: number, userId?: string }
 *
 * Drives Microsoft Learn with Playwright to request achievement code(s) for
 * the given course and records them in the history table.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateCodes } from '../../../../lib/microsoft-redeem/generate';

// Code generation drives a headless browser end-to-end (~60-90s per code).
export const config = {
  api: { responseLimit: false },
  maxDuration: 300,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const body = req.body || {};
  const courseNumber = (body.courseNumber || '').trim();
  const count = Number(body.count) || 1;
  const students = Number(body.students) || 1;
  const userId =
    typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null;

  if (!courseNumber) {
    return res.status(400).json({ ok: false, error: 'courseNumber is required' });
  }

  try {
    const result = await generateCodes(courseNumber, count, students, userId);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Code generation failed' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
