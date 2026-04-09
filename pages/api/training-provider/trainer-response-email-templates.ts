import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  ensureTrainerInvitationTemplateColumns,
  DEFAULT_TRAINER_ACCEPT_SUBJECT,
  DEFAULT_TRAINER_ACCEPT_BODY,
  DEFAULT_TRAINER_DECLINE_SUBJECT,
  DEFAULT_TRAINER_DECLINE_BODY,
} from '../../../lib/trainerInvitations';

/**
 * GET  /api/training-provider/trainer-response-email-templates
 * PUT  /api/training-provider/trainer-response-email-templates
 *
 * Manages the accept and decline follow-up email templates.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await ensureTrainerInvitationTemplateColumns((sql) => pool.query(sql));

  if (req.method === 'GET') {
    const result = await pool.query(
      `SELECT trainer_accept_email_subject, trainer_accept_email_body,
              trainer_decline_email_subject, trainer_decline_email_body
       FROM training_provider LIMIT 1`
    );
    const row = result.rows[0] || {};
    return res.status(200).json({
      success: true,
      data: {
        acceptSubject: row.trainer_accept_email_subject || DEFAULT_TRAINER_ACCEPT_SUBJECT,
        acceptBody: row.trainer_accept_email_body || DEFAULT_TRAINER_ACCEPT_BODY,
        declineSubject: row.trainer_decline_email_subject || DEFAULT_TRAINER_DECLINE_SUBJECT,
        declineBody: row.trainer_decline_email_body || DEFAULT_TRAINER_DECLINE_BODY,
      },
    });
  }

  if (req.method === 'PUT') {
    const { acceptSubject, acceptBody, declineSubject, declineBody } = req.body || {};
    await pool.query(
      `UPDATE training_provider SET
        trainer_accept_email_subject = $1,
        trainer_accept_email_body = $2,
        trainer_decline_email_subject = $3,
        trainer_decline_email_body = $4
       WHERE id = (SELECT id FROM training_provider LIMIT 1)`,
      [acceptSubject || null, acceptBody || null, declineSubject || null, declineBody || null]
    );
    return res.status(200).json({ success: true, message: 'Templates saved' });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
