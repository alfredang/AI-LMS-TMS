import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureSkillCodeTable, resolveAndCacheSkillCodes, upsertSkillCodes } from '../../../lib/ssg/courseSkillCode';

/**
 * Course → SSG assessment skill-code mapping for the bulk-assessment auto-fill.
 *
 *   GET ?course_codes=TGS-a,TGS-b  → { success, map } — cache-first; any miss does ONE live SSG
 *                                     lookup (from the course's existing assessments) and caches it.
 *   GET (no param)                 → all cached entries (no live lookups).
 *   POST { items:[{course_code,skill_code}] }  → upsert (manual save / correction).
 *
 * The value is stable per course (its SSG registration), so caching is safe; see lib/ssg/courseSkillCode.ts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureSkillCodeTable();

    if (req.method === 'GET') {
      const codesParam = String(req.query.course_codes || '').trim();
      if (!codesParam) {
        // No filter → return everything currently cached (no live lookups).
        return res.status(200).json({ success: true, map: await getCachedAll() });
      }
      const codes = codesParam.split(',').map((c) => c.trim()).filter(Boolean);
      const map = await resolveAndCacheSkillCodes(codes);   // cache-first + live-fallback + auto-cache
      return res.status(200).json({ success: true, map });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items
        : (body.course_code ? [{ course_code: body.course_code, skill_code: body.skill_code }] : []);
      const saved = await upsertSkillCodes(items);
      return res.status(200).json({ success: true, saved });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('course-skill-codes error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

// Return every cached entry (used when no course_codes filter is given).
async function getCachedAll(): Promise<Record<string, string>> {
  const pool = (await import('../../../lib/db')).default;
  const r = await pool.query<{ course_code: string; skill_code: string }>(
    `SELECT course_code, skill_code FROM course_skill_code ORDER BY course_code`
  );
  const map: Record<string, string> = {};
  for (const row of r.rows) map[row.course_code] = row.skill_code;
  return map;
}
