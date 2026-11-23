import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '@lib/db';
import { classFeedbackSummary } from '@lib/mobile/app';

/**
 * Read-only bridge for the native apps (TC LMS): the Course Feedback Summary of a class
 * this TMS handed over to the storefront (MMS). The storefront's mobile API (ai-mms,
 * MMD_MobileApi) calls it server-to-server with the class's handover key after it has
 * checked that the signed-in trainer teaches the class; it is never called by a browser,
 * so it needs `Authorization: Bearer <MOBILE_BRIDGE_SECRET>` and answers 503 with the
 * secret unset.
 *
 * POST { source_run_key } -> { success, data: { count, overall, questions[], comments[] } }
 * Averages and comments only, never names or emails (the trainer view's rule).
 * NON-WSQ ONLY: a handover source whose course code is not a C-prefix code is refused.
 */
function secretMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from((header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const secret = process.env.MOBILE_BRIDGE_SECRET;
  if (!secret) return res.status(503).json({ success: false, error: 'Bridge not configured' });
  if (!secretMatches(req.headers['authorization'], secret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const key = typeof req.body?.source_run_key === 'string' ? req.body.source_run_key.trim() : '';
  if (!key || key.length > 255) return res.status(400).json({ success: false, error: 'source_run_key required' });

  try {
    const src = (await pool.query(
      `SELECT course_code, tms_run_uuid::text AS run_uuid FROM mms_sync_source WHERE source_run_key = $1`,
      [key]
    )).rows[0];
    if (!src) return res.status(404).json({ success: false, error: 'Class not found' });
    if (!/^C[0-9]/i.test(String(src.course_code || '').trim())) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }
    const data = await classFeedbackSummary(src.run_uuid || null, key);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('[internal/class-feedback]', e instanceof Error ? e.message : e);
    return res.status(500).json({ success: false, error: 'Failed to load feedback' });
  }
}
