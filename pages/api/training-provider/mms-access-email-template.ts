import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import type { NextApiRequest, NextApiResponse } from 'next';

async function ensureColumns() {
  await pool.query(`
    ALTER TABLE training_provider
      ADD COLUMN IF NOT EXISTS mms_access_email_subject TEXT,
      ADD COLUMN IF NOT EXISTS mms_access_email_body TEXT
  `);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await ensureColumns();
      const result = await pool.query(
        `SELECT mms_access_email_subject, mms_access_email_body
           FROM training_provider
          ORDER BY created_at ASC NULLS LAST
          LIMIT 1`,
      );
      const row = result.rows[0] || {};
      return res.status(200).json({
        success: true,
        data: {
          mmsAccessEmailSubject: row.mms_access_email_subject || '',
          mmsAccessEmailBody: row.mms_access_email_body || '',
        },
      });
    } catch (error) {
      console.error('Error fetching MMS access email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch MMS access email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { mmsAccessEmailSubject, mmsAccessEmailBody } = req.body || {};
      if (typeof mmsAccessEmailSubject !== 'string' || typeof mmsAccessEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'Subject and body must be strings.' });
      }
      if (!mmsAccessEmailSubject.trim() || !mmsAccessEmailBody.trim()) {
        return res.status(400).json({ success: false, error: 'Subject and body cannot be blank.' });
      }
      if (mmsAccessEmailSubject.length > 500 || mmsAccessEmailBody.length > 20000) {
        return res.status(400).json({ success: false, error: 'The template is too long.' });
      }

      await ensureColumns();
      await pool.query(
        `UPDATE training_provider
            SET mms_access_email_subject = $1,
                mms_access_email_body = $2`,
        [mmsAccessEmailSubject, mmsAccessEmailBody],
      );
      return res.status(200).json({ success: true, message: 'MMS access email template updated successfully' });
    } catch (error) {
      console.error('Error updating MMS access email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update MMS access email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
