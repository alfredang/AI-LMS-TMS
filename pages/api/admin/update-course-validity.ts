import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { recordCourseChanges } from '../../../lib/courseChangeLog';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { courseId, casScore, esScore, fundingValidity, courseType, newCourseCode } = req.body;

  if (!courseId) {
    return res.status(400).json({ message: 'courseId is required' });
  }

  try {
    const setClauses = ['cas_score = $1', 'es_score = $2', 'funding_validity = $3'];
    const params: any[] = [
      casScore != null && casScore !== '' ? parseFloat(casScore) : null,
      esScore != null && esScore !== '' ? parseFloat(esScore) : null,
      fundingValidity || null,
    ];

    // Only touch course_type when an explicit, valid value is supplied — leaves
    // existing values (incl. IBF / non-WSQ) untouched otherwise.
    if (courseType === 'WSQ' || courseType === 'CASL' || courseType === 'Non-WSQ') {
      params.push(courseType);
      setClauses.push(`course_type = $${params.length}`);
    }

    // Only touch new_course_code when a NON-BLANK value is supplied. Blank means
    // "not supplied", never "erase" -- treating '' as a clear is exactly the bug
    // that silently wiped a live renewed code via the course editor. Clearing a
    // renewal is not something this route needs to do.
    if (newCourseCode !== undefined) {
      const trimmed = typeof newCourseCode === 'string' ? newCourseCode.trim() : newCourseCode;
      if (trimmed) {
        params.push(trimmed);
        setClauses.push(`new_course_code = $${params.length}`);
      }
    }

    params.push(courseId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Record what is about to change for Course Change Control. Runs BEFORE
      // the UPDATE (it reads the pre-update values); best-effort so an audit
      // problem can never cost the caller their edit.
      try {
        await client.query('SAVEPOINT before_change_log');
        const authUser = (req as any).authUser;
        await recordCourseChanges(
          client,
          courseId,
          {
            // The route always writes funding_validity (absent -> NULL), so a
            // clear is a real change and must be logged too.
            fundingValidity: fundingValidity ?? null,
            // course_type is only applied when valid -- log it only then, or the
            // log would claim a change the UPDATE never made.
            ...(courseType === 'WSQ' || courseType === 'CASL' || courseType === 'Non-WSQ'
              ? { courseType }
              : {}),
            newCourseCode,
          },
          authUser?.isService ? { userName: 'System' } : { userId: authUser?.id || null },
        );
        await client.query('RELEASE SAVEPOINT before_change_log');
      } catch (logError) {
        await client.query('ROLLBACK TO SAVEPOINT before_change_log');
        console.error('Course change log skipped:', (logError as Error).message);
      }

      await client.query(
        `UPDATE public.course
         SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length}`,
        params
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Failed to update course validity:', error);
    return res.status(500).json({ message: error.message || 'Failed to update' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
