import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { ensureTrainerInvitationTemplateColumns } from '@/lib/trainerInvitations';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      const result = await pool.query(
        `SELECT trainer_invitation_email_subject,
                trainer_invitation_email_body,
                trainer_invitation_email_cc,
                trainer_invitation_reply_to,
                trainer_exhausted_alert_recipients,
                trainer_invitation_min_lead_days
         FROM training_provider LIMIT 1`
      );
      const row = result.rows[0] || {};
      return res.status(200).json({
        success: true,
        data: {
          trainerInvitationEmailSubject: row.trainer_invitation_email_subject || '',
          trainerInvitationEmailBody: row.trainer_invitation_email_body || '',
          trainerInvitationEmailCc: row.trainer_invitation_email_cc || '',
          trainerInvitationReplyTo: row.trainer_invitation_reply_to || '',
          trainerExhaustedAlertRecipients: row.trainer_exhausted_alert_recipients || '',
          trainerInvitationMinLeadDays: row.trainer_invitation_min_lead_days ?? 1,
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
        trainerInvitationReplyTo,
        trainerExhaustedAlertRecipients,
        trainerInvitationMinLeadDays,
      } = req.body;
      if (typeof trainerInvitationEmailSubject !== 'string' || typeof trainerInvitationEmailBody !== 'string') {
        return res.status(400).json({ success: false, error: 'trainerInvitationEmailSubject and trainerInvitationEmailBody must be strings' });
      }
      // Optional fields — blank/undefined means "unset" (NULL).
      const blankToNull = (v: unknown): string | null =>
        typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
      const ccValue = blankToNull(trainerInvitationEmailCc);
      const replyToValue = blankToNull(trainerInvitationReplyTo);
      const alertRecipientsValue = blankToNull(trainerExhaustedAlertRecipients);
      // Min lead days: coerce to a non-negative integer, clamp [0, 365], default 1.
      const rawLead = Number(trainerInvitationMinLeadDays);
      const minLeadValue = Number.isFinite(rawLead) ? Math.min(Math.max(Math.trunc(rawLead), 0), 365) : 1;

      await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
      await pool.query(
        `UPDATE training_provider
           SET trainer_invitation_email_subject = $1,
               trainer_invitation_email_body = $2,
               trainer_invitation_email_cc = $3,
               trainer_invitation_reply_to = $4,
               trainer_exhausted_alert_recipients = $5,
               trainer_invitation_min_lead_days = $6`,
        [trainerInvitationEmailSubject, trainerInvitationEmailBody, ccValue, replyToValue, alertRecipientsValue, minLeadValue]
      );
      return res.status(200).json({ success: true, message: 'Trainer invitation email template updated successfully' });
    } catch (error) {
      console.error('Error updating trainer invitation email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update trainer invitation email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
