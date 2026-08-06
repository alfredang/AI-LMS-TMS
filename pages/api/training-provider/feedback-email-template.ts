import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let feedbackEmailSubject: string | null = null;
      let feedbackEmailBody: string | null = null;
      let feedbackEmailCc: string | null = null;
      try {
        const result = await pool.query('SELECT feedback_email_subject, feedback_email_body, feedback_email_cc FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          feedbackEmailSubject = result.rows[0].feedback_email_subject;
          feedbackEmailBody = result.rows[0].feedback_email_body;
          feedbackEmailCc = result.rows[0].feedback_email_cc;
        }
      } catch (e) {
        console.log('feedback_email columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { feedbackEmailSubject, feedbackEmailBody, feedbackEmailCc }
      });
    } catch (error) {
      console.error('Error fetching feedback email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch feedback email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { feedbackEmailSubject, feedbackEmailBody, feedbackEmailCc } = req.body;

      if (typeof feedbackEmailSubject !== 'string' || typeof feedbackEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'feedbackEmailSubject and feedbackEmailBody must be strings' });
      }

      try {
        await pool.query(
          'UPDATE training_provider SET feedback_email_subject = $1, feedback_email_body = $2, feedback_email_cc = $3',
          [feedbackEmailSubject, feedbackEmailBody, feedbackEmailCc || '']
        );
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS feedback_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS feedback_email_body TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS feedback_email_cc TEXT');
        await pool.query(
          'UPDATE training_provider SET feedback_email_subject = $1, feedback_email_body = $2, feedback_email_cc = $3',
          [feedbackEmailSubject, feedbackEmailBody, feedbackEmailCc || '']
        );
      }

      return res.status(200).json({ success: true, message: 'Feedback email template updated successfully' });
    } catch (error) {
      console.error('Error updating feedback email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update feedback email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
