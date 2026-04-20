import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_cc TEXT');
      const result = await pool.query('SELECT course_completion_email_subject, course_completion_email_body, course_completion_email_cc FROM training_provider LIMIT 1');
      const row = result.rows[0] || {};
      let courseCompletionEmailBody = row.course_completion_email_body || '';

      courseCompletionEmailBody = courseCompletionEmailBody
        .replace(/\{COMPANY_PHONE\}/g, '6100 0613')
        .replace(/\{COMPANY_EMAIL\}/g, 'enquiry@tertiaryinfotech.com')
        .replace(/\{COMPANY_SHORT_NAME\}/g, 'Tertiary Courses SG')
        .replace(/\{COMPANY_NAME\}/g, 'Tertiary Infotech');

      return res.status(200).json({
        success: true,
        data: {
          courseCompletionEmailSubject: row.course_completion_email_subject || '',
          courseCompletionEmailBody,
          courseCompletionEmailCc: row.course_completion_email_cc || '',
        }
      });
    } catch (error) {
      console.error('Error fetching course completion email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch course completion email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { courseCompletionEmailSubject, courseCompletionEmailBody, courseCompletionEmailCc } = req.body;
      if (typeof courseCompletionEmailSubject !== 'string' || typeof courseCompletionEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'courseCompletionEmailSubject and courseCompletionEmailBody must be strings' });
      }

      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_completion_email_cc TEXT');
      await pool.query(
        'UPDATE training_provider SET course_completion_email_subject = $1, course_completion_email_body = $2, course_completion_email_cc = $3',
        [courseCompletionEmailSubject, courseCompletionEmailBody, courseCompletionEmailCc || '']
      );
      return res.status(200).json({ success: true, message: 'Course completion email template updated successfully' });
    } catch (error) {
      console.error('Error updating course completion email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update course completion email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
