import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureSkillCodeTable, getCourseTypes, resolveAndCacheSkillCodes, upsertSkillCodes } from '../../../lib/ssg/courseSkillCode';

/**
 * Course → SSG assessment skill-code mapping for the bulk-assessment auto-fill.
 *
 *   GET ?course_codes=TGS-a,TGS-b  → { success, map } — cache-first; any miss does ONE live SSG
 *                                     lookup (from the course's existing assessments) and caches it.
 *   GET &type_codes=TGS-a,TGS-c    → adds { types } — course type per code (plain DB read, no SSG).
 *                                     Kept separate from course_codes so asking "what type is this?"
 *                                     never drags a course through an expensive skill-code lookup.
 *   GET (no param)                 → all cached entries (no live lookups).
 *   POST { items:[{course_code,skill_code}] }  → upsert (manual save / correction).
 *
 * The value is stable per course (its SSG registration), so caching is safe; see lib/ssg/courseSkillCode.ts.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureSkillCodeTable();

    if (req.method === 'GET') {
      const codesParam = String(req.query.course_codes || '').trim();
      const typeCodesParam = String(req.query.type_codes || '').trim();
      const split = (v: string) => v.split(',').map((c) => c.trim()).filter(Boolean);

      const types = typeCodesParam ? await getCourseTypes(split(typeCodesParam)) : undefined;

      if (!codesParam) {
        // No codes to resolve. Dump the whole cache only when nothing at all was asked for —
        // a types-only caller wants its answer, not every mapping we hold.
        return res.status(200).json({
          success: true,
          map: typeCodesParam ? {} : await getCachedAll(),
          ...(types ? { types } : {}),
        });
      }

      const map = await resolveAndCacheSkillCodes(split(codesParam));   // cache-first + live-fallback + auto-cache
      return res.status(200).json({ success: true, map, ...(types ? { types } : {}) });
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

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
