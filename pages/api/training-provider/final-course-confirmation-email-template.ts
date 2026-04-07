import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { ensureTrainerInvitationTemplateColumns } from '@/lib/trainerInvitations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      const result = await pool.query('SELECT final_course_confirmation_email_subject, final_course_confirmation_email_body FROM training_provider LIMIT 1');
      const row = result.rows[0] || {};
      return res.status(200).json({
        success: true,
        data: {
          finalCourseConfirmationEmailSubject: row.final_course_confirmation_email_subject || '',
          finalCourseConfirmationEmailBody: row.final_course_confirmation_email_body || '',
        }
      });
    } catch (error) {
      console.error('Error fetching final course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch final course confirmation email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { finalCourseConfirmationEmailSubject, finalCourseConfirmationEmailBody } = req.body;
      if (typeof finalCourseConfirmationEmailSubject !== 'string' || typeof finalCourseConfirmationEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'finalCourseConfirmationEmailSubject and finalCourseConfirmationEmailBody must be strings' });
      }
      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      await pool.query(
        'UPDATE training_provider SET final_course_confirmation_email_subject = $1, final_course_confirmation_email_body = $2',
        [finalCourseConfirmationEmailSubject, finalCourseConfirmationEmailBody]
      );
      return res.status(200).json({ success: true, message: 'Final course confirmation email template updated successfully' });
    } catch (error) {
      console.error('Error updating final course confirmation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update final course confirmation email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
