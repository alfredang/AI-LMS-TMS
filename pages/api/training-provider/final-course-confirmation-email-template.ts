import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      const tp = await getTrainingPartnerIdentifiers();
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_cc TEXT');
      const result = await pool.query('SELECT final_course_confirmation_email_subject, final_course_confirmation_email_body, final_course_confirmation_email_cc FROM training_provider LIMIT 1');
      const row = result.rows[0] || {};
      let finalCourseConfirmationEmailBody = row.final_course_confirmation_email_body || '';

      // Replace template variables with values from Company Settings
      finalCourseConfirmationEmailBody = finalCourseConfirmationEmailBody
        .replace(/\{COMPANY_PHONE\}/g, tp.contactTel)
        .replace(/\{COMPANY_EMAIL\}/g, tp.supportEmail || tp.companyEmail)
        .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname)
        .replace(/\{COMPANY_NAME\}/g, tp.name);

      return res.status(200).json({
        success: true,
        data: {
          finalCourseConfirmationEmailSubject: row.final_course_confirmation_email_subject || '',
          finalCourseConfirmationEmailBody,
          finalCourseConfirmationEmailCc: row.final_course_confirmation_email_cc || '',
        }
      });
    } catch (error) {
      console.error('Error fetching final course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch final course confirmation email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      let { finalCourseConfirmationEmailSubject, finalCourseConfirmationEmailBody, finalCourseConfirmationEmailCc } = req.body;
      if (typeof finalCourseConfirmationEmailSubject !== 'string' || typeof finalCourseConfirmationEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'finalCourseConfirmationEmailSubject and finalCourseConfirmationEmailBody must be strings' });
      }

      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_subject TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_body TEXT');
      await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS final_course_confirmation_email_cc TEXT');
      await pool.query(
        'UPDATE training_provider SET final_course_confirmation_email_subject = $1, final_course_confirmation_email_body = $2, final_course_confirmation_email_cc = $3',
        [finalCourseConfirmationEmailSubject, finalCourseConfirmationEmailBody, finalCourseConfirmationEmailCc || '']
      );
      return res.status(200).json({ success: true, message: 'Final course confirmation email template updated successfully' });
    } catch (error) {
      console.error('Error updating final course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update final course confirmation email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
