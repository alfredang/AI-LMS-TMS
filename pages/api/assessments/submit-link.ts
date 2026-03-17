import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// API endpoint for submitting link-based assessments (Written Assessment / Practical Performance Assessment)
// These don't have an assessment_id in the assessment table, so we track them separately

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Get submissions for a specific user and course run
    const { userId, courseRunId } = req.query;

    if (!userId || !courseRunId) {
      return res.status(400).json({ success: false, error: 'Missing required parameters: userId and courseRunId' });
    }

    try {
      const result = await pool.query(
        `SELECT * FROM link_assessment_submission
         WHERE user_id = $1 AND course_run_id = $2
         ORDER BY submitted_at DESC`,
        [userId, courseRunId]
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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, courseRunId, assessmentType, fileName, fileUrl } = req.body;

  if (!userId || !courseRunId || !assessmentType || !fileName || !fileUrl) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: userId, courseRunId, assessmentType, fileName, fileUrl'
    });
  }

  // Validate assessment type
  if (!['written', 'practical'].includes(assessmentType)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid assessmentType. Must be "written" or "practical".'
    });
  }

  try {
    // Check if a submission already exists for this user, course run, and assessment type
    const existingSubmission = await pool.query(
      `SELECT id FROM link_assessment_submission
       WHERE user_id = $1 AND course_run_id = $2 AND assessment_type = $3`,
      [userId, courseRunId, assessmentType]
    );

    if (existingSubmission.rows.length > 0) {
      // Update existing submission (resubmission)
      await pool.query(
        `UPDATE link_assessment_submission
         SET file_name = $1, file_url = $2, submitted_at = NOW()
         WHERE user_id = $3 AND course_run_id = $4 AND assessment_type = $5`,
        [fileName, fileUrl, userId, courseRunId, assessmentType]
      );

      console.log(`✅ Link assessment resubmitted: ${assessmentType} for user ${userId}`);
      return res.status(200).json({
        success: true,
        message: 'Assessment resubmitted successfully',
        isResubmission: true
      });
    } else {
      // Create new submission
      await pool.query(
        `INSERT INTO link_assessment_submission (user_id, course_run_id, assessment_type, file_name, file_url, submitted_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [userId, courseRunId, assessmentType, fileName, fileUrl]
      );

      console.log(`✅ Link assessment submitted: ${assessmentType} for user ${userId}`);
      return res.status(201).json({
        success: true,
        message: 'Assessment submitted successfully',
        isResubmission: false
      });
    }
  } catch (error: any) {
    console.error('❌ Error submitting link assessment:', error);

    // If table doesn't exist, provide helpful error message
    if (error.message.includes('relation "link_assessment_submission" does not exist')) {
      return res.status(500).json({
        success: false,
        error: 'Database table not found. Please run the migration to create the link_assessment_submission table.',
        migration: `
CREATE TABLE IF NOT EXISTS link_assessment_submission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
  assessment_type VARCHAR(20) NOT NULL CHECK (assessment_type IN ('written', 'practical')),
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, course_run_id, assessment_type)
);

CREATE INDEX idx_link_assessment_submission_user ON link_assessment_submission(user_id);
CREATE INDEX idx_link_assessment_submission_course_run ON link_assessment_submission(course_run_id);
`
      });
    }

    return res.status(500).json({ success: false, error: error.message });
  }
}
