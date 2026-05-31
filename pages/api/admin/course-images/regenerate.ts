import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { renderCourseImagePng } from '../../../../lib/courseImage/renderer';
import { uploadToR2, isR2Configured } from '../../../../lib/r2';

// Regenerate the banner for a single course using the supplied title (which
// may differ from what's in DB if the user has unsaved edits in the form).
// Uses a timestamped R2 key so each regeneration produces a fresh URL —
// bypasses the immutable cache header on prior banners.

export const config = {
  api: { responseLimit: false, bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isR2Configured())) {
    return res.status(500).json({
      error: 'R2 not configured. Set credentials under Company Settings → Integrations → R2.',
    });
  }

  const { courseId, title } = req.body as { courseId?: string; title?: string };
  if (!courseId || typeof courseId !== 'string') {
    return res.status(400).json({ error: 'courseId required' });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title required' });
  }

  try {
    const png = await renderCourseImagePng(title);
    // Sanitise courseId for use in S3 key (drafts use prefixes like "course_<ts>").
    const safeId = courseId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const key = `course-banners/${safeId}-${Date.now()}.png`;
    const url = await uploadToR2(key, png, 'image/png');

    // Best-effort DB update — only succeeds when courseId is a real UUID
    // that exists in the course table. New/unsaved courses use temp IDs
    // (course_<ts>) so the update touches zero rows and that's fine —
    // the form holds the URL until save.
    try {
      await pool.query(
        'UPDATE course SET image_url = $1 WHERE id::text = $2',
        [url, courseId],
      );
    } catch {
      // ignore non-UUID cast errors
    }

    return res.status(200).json({ url, key, bytes: png.length });
  } catch (err) {
    console.error('[course-images/regenerate] failed:', err);
    return res.status(500).json({ error: String(err) });
  }
}
