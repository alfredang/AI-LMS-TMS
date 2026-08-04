import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let courseConfirmationEmailSubject: string | null = null;
      let courseConfirmationEmailBody: string | null = null;
      let courseConfirmationEmailCc: string | null = null;
      try {
        const result = await pool.query('SELECT course_confirmation_email_subject, course_confirmation_email_body, course_confirmation_email_cc FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          courseConfirmationEmailSubject = result.rows[0].course_confirmation_email_subject;
          courseConfirmationEmailBody = result.rows[0].course_confirmation_email_body;
          courseConfirmationEmailCc = result.rows[0].course_confirmation_email_cc;
        }
      } catch (e) {
        console.log('course_confirmation_email columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { courseConfirmationEmailSubject, courseConfirmationEmailBody, courseConfirmationEmailCc }
      });
    } catch (error) {
      console.error('Error fetching course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch course confirmation email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { courseConfirmationEmailSubject, courseConfirmationEmailBody, courseConfirmationEmailCc } = req.body;
      if (typeof courseConfirmationEmailSubject !== 'string' || typeof courseConfirmationEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'courseConfirmationEmailSubject and courseConfirmationEmailBody must be strings' });
      }

      try {
        await pool.query(
          'UPDATE training_provider SET course_confirmation_email_subject = $1, course_confirmation_email_body = $2, course_confirmation_email_cc = $3',
          [courseConfirmationEmailSubject, courseConfirmationEmailBody, courseConfirmationEmailCc || '']
        );
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_confirmation_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_confirmation_email_body TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS course_confirmation_email_cc TEXT');
        await pool.query(
          'UPDATE training_provider SET course_confirmation_email_subject = $1, course_confirmation_email_body = $2, course_confirmation_email_cc = $3',
          [courseConfirmationEmailSubject, courseConfirmationEmailBody, courseConfirmationEmailCc || '']
        );
      }

      return res.status(200).json({ success: true, message: 'Course confirmation email template updated successfully' });
    } catch (error) {
      console.error('Error updating course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update course confirmation email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
