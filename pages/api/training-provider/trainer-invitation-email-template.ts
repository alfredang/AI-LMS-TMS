import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { ensureTrainerInvitationTemplateColumns } from '@/lib/trainerInvitations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      const result = await pool.query(
        `SELECT trainer_invitation_email_subject,
                trainer_invitation_email_body,
                trainer_invitation_email_cc
         FROM training_provider LIMIT 1`
      );
      const row = result.rows[0] || {};
      return res.status(200).json({
        success: true,
        data: {
          trainerInvitationEmailSubject: row.trainer_invitation_email_subject || '',
          trainerInvitationEmailBody: row.trainer_invitation_email_body || '',
          trainerInvitationEmailCc: row.trainer_invitation_email_cc || '',
        },
      });
    } catch (error) {
      console.error('Error fetching trainer invitation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch trainer invitation email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const {
        trainerInvitationEmailSubject,
        trainerInvitationEmailBody,
        trainerInvitationEmailCc,
      } = req.body;
      if (typeof trainerInvitationEmailSubject !== 'string' || typeof trainerInvitationEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'trainerInvitationEmailSubject and trainerInvitationEmailBody must be strings' });
      }
      // CC is optional — accept empty string, null, or undefined as "no CC"
      const ccValue: string | null =
        typeof trainerInvitationEmailCc === 'string' && trainerInvitationEmailCc.trim().length > 0
          ? trainerInvitationEmailCc.trim()
          : null;

      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      await pool.query(
        `UPDATE training_provider
           SET trainer_invitation_email_subject = $1,
               trainer_invitation_email_body = $2,
               trainer_invitation_email_cc = $3`,
        [trainerInvitationEmailSubject, trainerInvitationEmailBody, ccValue]
      );
      return res.status(200).json({ success: true, message: 'Trainer invitation email template updated successfully' });
    } catch (error) {
      console.error('Error updating trainer invitation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update trainer invitation email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
