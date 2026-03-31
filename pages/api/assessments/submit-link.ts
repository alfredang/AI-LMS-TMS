import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// API endpoint for submitting link-based assessments (Written Assessment / Practical Performance Assessment)
// Supports multiple file uploads per assessment type

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { userId, courseRunId } = req.query;

    if (!userId || !courseRunId) {
      return res.status(400).json({ success: false, error: 'Missing required parameters: userId and courseRunId' });
    }

    try {
      const result = await pool.query(
        `SELECT * FROM link_assessment_submission
         WHERE user_id = $1 AND course_run_id = $2
         ORDER BY assessment_type, submitted_at DESC`,
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

  const { userId, courseRunId, assessmentType, fileName, fileUrl } = req.body;

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
    // Always insert a new submission (multiple files allowed)
    const result = await pool.query(
      `INSERT INTO link_assessment_submission (user_id, course_run_id, assessment_type, file_name, file_url, submitted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [userId, courseRunId, assessmentType, fileName, fileUrl]
    );

    console.log(`✅ Link assessment submitted: ${assessmentType} for user ${userId} — file: ${fileName}`);
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
