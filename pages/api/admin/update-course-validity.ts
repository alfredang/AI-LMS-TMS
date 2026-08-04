import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

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
    if (courseType === 'WSQ' || courseType === 'Non-WSQ') {
      params.push(courseType);
      setClauses.push(`course_type = $${params.length}`);
    }

    // Only touch new_course_code when the field is present in the request body,
    // so callers that don't manage it leave the existing value untouched. An
    // empty string clears it back to NULL.
    if (newCourseCode !== undefined) {
      const trimmed = typeof newCourseCode === 'string' ? newCourseCode.trim() : newCourseCode;
      params.push(trimmed ? trimmed : null);
      setClauses.push(`new_course_code = $${params.length}`);
    }

    params.push(courseId);
    await pool.query(
      `UPDATE public.course
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Failed to update course validity:', error);
    return res.status(500).json({ message: error.message || 'Failed to update' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
