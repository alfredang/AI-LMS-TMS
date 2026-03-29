import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Run this migration before using this API:
// ALTER TABLE course_run ADD COLUMN IF NOT EXISTS written_assessment_published BOOLEAN NOT NULL DEFAULT FALSE;
// ALTER TABLE course_run ADD COLUMN IF NOT EXISTS practical_assessment_published BOOLEAN NOT NULL DEFAULT FALSE;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId, field, published } = req.body;

  if (!courseRunId || !field || typeof published !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Missing required fields: courseRunId, field, published' });
  }

  const legacyFields: Record<string, string> = {
    written: 'written_assessment_published',
    practical: 'practical_assessment_published',
  };

  const dbField = legacyFields[field];

  try {
    if (dbField) {
      // Legacy written/practical fields
      await pool.query(
        `UPDATE course_run SET ${dbField} = $1 WHERE id = $2`,
        [published, courseRunId]
      );
    } else {
      // New assessment methods - store in published_assessment_methods JSONB
      await pool.query(
        `UPDATE course_run
         SET published_assessment_methods = COALESCE(published_assessment_methods, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ [field]: published }), courseRunId]
      );
    }

    return res.status(200).json({
      success: true,
      message: `${field} publish set to ${published}`,
    });
  } catch (error: any) {
    console.error('❌ Error updating assessment link publish status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
