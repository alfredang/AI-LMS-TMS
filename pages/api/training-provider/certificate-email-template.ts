import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let certificateEmailSubject: string | null = null;
      let certificateEmailBody: string | null = null;
      let certificateEmailCc: string | null = null;
      try {
        const result = await pool.query('SELECT certificate_email_subject, certificate_email_body, certificate_email_cc FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          certificateEmailSubject = result.rows[0].certificate_email_subject;
          certificateEmailBody = result.rows[0].certificate_email_body;
          certificateEmailCc = result.rows[0].certificate_email_cc;
        }
      } catch (e) {
        console.log('certificate_email columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { certificateEmailSubject, certificateEmailBody, certificateEmailCc }
      });
    } catch (error) {
      console.error('Error fetching certificate email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch certificate email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { certificateEmailSubject, certificateEmailBody, certificateEmailCc } = req.body;

      if (typeof certificateEmailSubject !== 'string' || typeof certificateEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'certificateEmailSubject and certificateEmailBody must be strings' });
      }

      try {
        await pool.query(
          'UPDATE training_provider SET certificate_email_subject = $1, certificate_email_body = $2, certificate_email_cc = $3',
          [certificateEmailSubject, certificateEmailBody, certificateEmailCc || '']
        );
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS certificate_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS certificate_email_body TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS certificate_email_cc TEXT');
        await pool.query(
          'UPDATE training_provider SET certificate_email_subject = $1, certificate_email_body = $2, certificate_email_cc = $3',
          [certificateEmailSubject, certificateEmailBody, certificateEmailCc || '']
        );
      }

      return res.status(200).json({ success: true, message: 'Certificate email template updated successfully' });
    } catch (error) {
      console.error('Error updating certificate email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update certificate email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
