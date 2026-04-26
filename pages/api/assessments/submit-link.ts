import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// API endpoint for submitting link-based assessments (Written Assessment / Practical Performance Assessment)
// Supports multiple file uploads per assessment type

async function resolveAppUserId(userId: string, userEmail?: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
  const result = await pool.query(
    `SELECT id
       FROM public.app_user
      WHERE ($3::boolean AND id = $1::uuid)
         OR ($3::boolean AND supabase_user_id = $1::uuid)
         OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2::text))
         OR ($2::text IS NOT NULL AND LOWER(COALESCE(secondary_email, '')) = LOWER($2::text))
      ORDER BY
        CASE
          WHEN $3::boolean AND id = $1::uuid THEN 1
          WHEN $3::boolean AND supabase_user_id = $1::uuid THEN 2
          ELSE 3
        END
      LIMIT 1`,
    [isUuid ? userId : null, userEmail || null, isUuid]
  );

  return result.rows[0]?.id || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { userId, userEmail, courseRunId } = req.query;

    if (!userId || !courseRunId) {
      return res.status(400).json({ success: false, error: 'Missing required parameters: userId and courseRunId' });
    }

    try {
      const appUserId = await resolveAppUserId(
        String(userId),
        typeof userEmail === 'string' ? userEmail : undefined
      );

      if (!appUserId) {
        return res.status(200).json({ success: true, data: [] });
      }

      const result = await pool.query(
        `SELECT * FROM link_assessment_submission
         WHERE user_id = $1 AND course_run_id = $2
         ORDER BY assessment_type, submitted_at DESC`,
        [appUserId, courseRunId]
      );

      return res.status(200).json({
        success: true,
        data: result.rows
      });
    } catch (error: any) {
      console.error('❌ Error fetching link assessment submissions:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    const { submissionId } = req.body;

    if (!submissionId) {
      return res.status(400).json({ success: false, error: 'Missing required field: submissionId' });
    }

    try {
      await pool.query('DELETE FROM link_assessment_submission WHERE id = $1', [submissionId]);
      return res.status(200).json({ success: true, message: 'Submission deleted' });
    } catch (error: any) {
      console.error('❌ Error deleting submission:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, userEmail, courseRunId, assessmentType, fileName, fileUrl } = req.body;

  if (!userId || !courseRunId || !assessmentType || !fileName || !fileUrl) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: userId, courseRunId, assessmentType, fileName, fileUrl'
    });
  }

  const validTypes = ['written', 'practical', 'writtenAssessment', 'practicalExam', 'caseStudy', 'rolePlay', 'oralQuestioning', 'project', 'assignment'];
  if (!validTypes.includes(assessmentType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid assessmentType. Must be one of: ${validTypes.join(', ')}`
    });
  }

  try {
    const appUserId = await resolveAppUserId(userId, userEmail);

    if (!appUserId) {
      return res.status(400).json({
        success: false,
        error: 'Could not find this learner account. Please log out and log in again, then retry.'
      });
    }

    // Always insert a new submission (multiple files allowed)
    const result = await pool.query(
      `INSERT INTO link_assessment_submission (user_id, course_run_id, assessment_type, file_name, file_url, submitted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [appUserId, courseRunId, assessmentType, fileName, fileUrl]
    );

    console.log(`✅ Link assessment submitted: ${assessmentType} for user ${appUserId} — file: ${fileName}`);
    return res.status(201).json({
      success: true,
      message: 'Assessment submitted successfully',
      id: result.rows[0].id
    });
  } catch (error: any) {
    console.error('❌ Error submitting link assessment:', error);

    if (error.message.includes('relation "link_assessment_submission" does not exist')) {
      return res.status(500).json({
        success: false,
        error: 'Database table not found. Please run the migration to create the link_assessment_submission table.'
      });
    }

    return res.status(500).json({ success: false, error: error.message });
  }
}
