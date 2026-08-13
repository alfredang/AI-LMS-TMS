import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { recordCourseChanges } from '../../../lib/courseChangeLog';

/**
 * Rename courses by course_code -- title ONLY.
 *
 * Exists because /api/courses/update-course is a whole-record replace: it
 * deletes and recreates every learning_unit/subtopic and assigns ~35 columns
 * bare, so any field the caller omits is nulled. That is the correct shape for
 * the course editor, which always posts the full record, and the wrong shape
 * for a rename. This route touches exactly one column.
 *
 * Deliberately does NOT touch tsc_title: it is a separate SSG-facing field and
 * some courses set it independently of the display title.
 *
 * PUT { updates: [{ courseCode, title }, ...], dryRun?: boolean }
 */

interface TitleUpdate {
  courseCode: string;
  title: string;
}

type ResultRow = {
  courseCode: string;
  status: 'updated' | 'unchanged' | 'not_found' | 'ambiguous';
  oldTitle?: string | null;
  newTitle?: string;
  matches?: number;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { updates, dryRun } = req.body as { updates?: TitleUpdate[]; dryRun?: boolean };

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ message: 'updates must be a non-empty array' });
  }

  const cleaned: TitleUpdate[] = [];
  for (const u of updates) {
    const courseCode = typeof u?.courseCode === 'string' ? u.courseCode.trim() : '';
    const title = typeof u?.title === 'string' ? u.title.trim() : '';
    // A blank title would erase the course name -- always a caller bug, never intent.
    if (!courseCode || !title) {
      return res.status(400).json({
        message: 'Each update needs a non-empty courseCode and title',
        offending: u,
      });
    }
    cleaned.push({ courseCode, title });
  }

  const seen = new Set<string>();
  for (const u of cleaned) {
    if (seen.has(u.courseCode)) {
      return res.status(400).json({ message: `Duplicate courseCode in request: ${u.courseCode}` });
    }
    seen.add(u.courseCode);
  }

  const results: ResultRow[] = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const authUser = (req as any).authUser;

    for (const { courseCode, title } of cleaned) {
      // Resolve the code to an id: course_change_log keys on course_id, and the
      // UNIQUE constraint on course_code is not a guarantee across tenants'
      // historical data -- so verify a single match rather than assuming one.
      const { rows } = await client.query(
        `SELECT id, title FROM public.course WHERE course_code = $1`,
        [courseCode]
      );

      if (rows.length === 0) {
        results.push({ courseCode, status: 'not_found' });
        continue;
      }
      if (rows.length > 1) {
        results.push({ courseCode, status: 'ambiguous', matches: rows.length });
        continue;
      }

      const { id, title: oldTitle } = rows[0];

      if (oldTitle === title) {
        results.push({ courseCode, status: 'unchanged', oldTitle, newTitle: title });
        continue;
      }

      if (!dryRun) {
        // Best-effort audit, same pattern as the other course routes: a logging
        // failure must not cost the rename.
        try {
          await client.query('SAVEPOINT before_change_log');
          await recordCourseChanges(
            client,
            id,
            { title },
            authUser?.isService ? { userName: 'System' } : { userId: authUser?.id || null },
            'Bulk course title update'
          );
          await client.query('RELEASE SAVEPOINT before_change_log');
        } catch (logError) {
          await client.query('ROLLBACK TO SAVEPOINT before_change_log');
          console.error('Course change log skipped:', (logError as Error).message);
        }

        await client.query(
          `UPDATE public.course SET title = $1, updated_at = NOW() WHERE id = $2`,
          [title, id]
        );
      }

      results.push({ courseCode, status: 'updated', oldTitle, newTitle: title });
    }

    // A dry run must leave nothing behind, including the audit rows above.
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const summary = {
    updated: results.filter(r => r.status === 'updated').length,
    unchanged: results.filter(r => r.status === 'unchanged').length,
    notFound: results.filter(r => r.status === 'not_found').length,
    ambiguous: results.filter(r => r.status === 'ambiguous').length,
  };

  return res.status(200).json({ success: true, dryRun: !!dryRun, summary, results });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
