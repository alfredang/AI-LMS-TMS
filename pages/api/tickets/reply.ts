import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { emailService } from '../../../lib/services/emailService';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { ticketId, userId, userRole, message } = req.body;

    if (!ticketId || !userId || !userRole || !message) {
      return res.status(400).json({ success: false, message: 'ticketId, userId, userRole, and message are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert the reply
      const replyResult = await client.query(
        `INSERT INTO support_ticket_reply (ticket_id, user_id, user_role, message)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [ticketId, userId, userRole, message]
      );

      // If admin is replying and ticket is still "Open", update to "In Progress"
      if (userRole === 'admin') {
        await client.query(
          `UPDATE support_ticket SET status = 'In Progress' WHERE id = $1 AND status = 'Open'`,
          [ticketId]
        );
      }

      // Always bump updated_at
      await client.query(
        `UPDATE support_ticket SET updated_at = now() WHERE id = $1`,
        [ticketId]
      );

      await client.query('COMMIT');

      // Fetch the reply with user name
      const fullReply = await pool.query(
        `SELECT str.*, au.full_name AS user_name
         FROM support_ticket_reply str
         JOIN app_user au ON str.user_id = au.id
         WHERE str.id = $1`,
        [replyResult.rows[0].id]
      );

      // Notify the other party by email (best-effort — never block the reply).
      // The support address always comes from the Company Setting (training_provider.
      // support_email, falling back to company_email) via getTrainingPartnerIdentifiers();
      // it is never hardcoded.
      try {
        const ticketInfo = await pool.query(
          `SELECT t.ticket_number, t.subject, owner.email AS owner_email, owner.full_name AS owner_name
           FROM support_ticket t
           JOIN app_user owner ON owner.id = t.user_id
           WHERE t.id = $1`,
          [ticketId]
        );
        if (ticketInfo.rows.length > 0) {
          const { ticket_number, subject, owner_email, owner_name } = ticketInfo.rows[0];
          const replierName = fullReply.rows[0]?.user_name || 'Support';
          const tp = await getTrainingPartnerIdentifiers();
          const supportEmail = tp.supportEmail || tp.companyEmail;
          const orgName = tp.name || 'Support Team';

          if (userRole === 'admin') {
            // Admin replied → notify the ticket owner (learner). Replies route back
            // to the Company Setting support address.
            if (owner_email) {
              await emailService.sendEmail({
                to: owner_email,
                replyTo: supportEmail || undefined,
                subject: `Re: Support Ticket ${ticket_number} - ${subject}`,
                text: `Dear ${owner_name},\n\nThere is a new reply to your support ticket (${ticket_number}).\n\n${message}\n\nPlease log in to your dashboard to view the full conversation and reply.\n\nBest Regards,\n${orgName}`,
                html: `
                  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
                    <p>Dear ${owner_name},</p>
                    <p>There is a new reply to your support ticket (<strong>${ticket_number}</strong>).</p>
                    <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; margin-left: 0; white-space: pre-wrap;">${message}</blockquote>
                    <p>Please log in to your dashboard to view the full conversation and reply.</p>
                    <p>Best Regards,<br>${orgName}</p>
                  </div>
                `,
              }).catch(err => console.error('Failed to notify ticket owner of reply:', err));
            }
          } else {
            // Learner (or non-admin) replied → notify the Company Setting support address.
            if (supportEmail) {
              await emailService.sendEmail({
                to: supportEmail,
                replyTo: owner_email || undefined,
                subject: `New reply on Support Ticket ${ticket_number} - ${subject}`,
                text: `${replierName} (${owner_email}) has replied to support ticket ${ticket_number}.\n\n${message}\n\nPlease log in to the admin dashboard to view and reply to this ticket.`,
                html: `
                  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
                    <p>${replierName} (${owner_email}) has replied to support ticket <strong>${ticket_number}</strong>.</p>
                    <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; margin-left: 0; white-space: pre-wrap;">${message}</blockquote>
                    <p>Please log in to the admin dashboard to view and reply to this ticket.</p>
                  </div>
                `,
              }).catch(err => console.error('Failed to notify support of reply:', err));
            }
          }
        }
      } catch (notifyErr) {
        console.error('Failed to send support ticket reply notification:', notifyErr);
      }

      res.status(201).json({
        success: true,
        data: fullReply.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating ticket reply:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
