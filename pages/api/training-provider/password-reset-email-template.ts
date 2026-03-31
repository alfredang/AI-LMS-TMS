import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let passwordResetEmailSubject: string | null = null;
      let passwordResetEmailBody: string | null = null;
      try {
        const result = await pool.query('SELECT password_reset_email_subject, password_reset_email_body FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          passwordResetEmailSubject = result.rows[0].password_reset_email_subject;
          passwordResetEmailBody = result.rows[0].password_reset_email_body;
        }
      } catch (e) {
        console.log('password_reset_email columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { passwordResetEmailSubject, passwordResetEmailBody }
      });
    } catch (error) {
      console.error('Error fetching password reset email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch password reset email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { passwordResetEmailSubject, passwordResetEmailBody } = req.body;

      if (typeof passwordResetEmailSubject !== 'string' || typeof passwordResetEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'passwordResetEmailSubject and passwordResetEmailBody must be strings' });
      }

      try {
        await pool.query(
          'UPDATE training_provider SET password_reset_email_subject = $1, password_reset_email_body = $2',
          [passwordResetEmailSubject, passwordResetEmailBody]
        );
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS password_reset_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS password_reset_email_body TEXT');
        await pool.query(
          'UPDATE training_provider SET password_reset_email_subject = $1, password_reset_email_body = $2',
          [passwordResetEmailSubject, passwordResetEmailBody]
        );
      }

      return res.status(200).json({ success: true, message: 'Password reset email template updated successfully' });
    } catch (error) {
      console.error('Error updating password reset email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update password reset email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
