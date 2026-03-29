import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let otpEmailSubject: string | null = null;
      let otpEmailBody: string | null = null;
      try {
        const result = await pool.query('SELECT otp_email_subject, otp_email_body FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          otpEmailSubject = result.rows[0].otp_email_subject;
          otpEmailBody = result.rows[0].otp_email_body;
        }
      } catch (e) {
        console.log('otp_email_subject/otp_email_body columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { otpEmailSubject, otpEmailBody }
      });
    } catch (error) {
      console.error('Error fetching OTP email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch OTP email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { otpEmailSubject, otpEmailBody } = req.body;

      if (typeof otpEmailSubject !== 'string' || typeof otpEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'otpEmailSubject and otpEmailBody must be strings' });
      }

      try {
        await pool.query('UPDATE training_provider SET otp_email_subject = $1, otp_email_body = $2', [otpEmailSubject, otpEmailBody]);
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS otp_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS otp_email_body TEXT');
        await pool.query('UPDATE training_provider SET otp_email_subject = $1, otp_email_body = $2', [otpEmailSubject, otpEmailBody]);
      }

      return res.status(200).json({ success: true, message: 'OTP email template updated successfully' });
    } catch (error) {
      console.error('Error updating OTP email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update OTP email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
