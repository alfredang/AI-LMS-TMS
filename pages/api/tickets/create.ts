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
    const { userId, subject, description, category } = req.body;

    if (!userId || !subject || !description) {
      return res.status(400).json({ success: false, message: 'userId, subject, and description are required' });
    }

    // Generate ticket number from sequence
    const seqResult = await pool.query("SELECT nextval('support_ticket_number_seq') AS seq");
    const seq = seqResult.rows[0].seq;
    const ticketNumber = `TKT-${String(seq).padStart(6, '0')}`;

    const result = await pool.query(
      `INSERT INTO support_ticket (user_id, ticket_number, subject, description, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, ticketNumber, subject, description, category || 'General']
    );

    // Fetch user details for the email
    const userResult = await pool.query(`SELECT email, full_name FROM app_user WHERE id = $1`, [userId]);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      
      // 1. Notify Admin
      const tp = await getTrainingPartnerIdentifiers();
      await emailService.sendEmail({
        to: tp.supportEmail || tp.companyEmail,
        subject: `New Support Ticket Raised: ${ticketNumber} - ${subject}`,
        text: `A new support ticket has been raised by ${user.full_name} (${user.email}).\n\nTicket Number: ${ticketNumber}\nCategory: ${category}\nSubject: ${subject}\n\nDescription:\n${description}\n\nPlease login to the admin dashboard to view and reply to this ticket.`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
            <p>A new support ticket has been raised by ${user.full_name} (${user.email}).</p>
            <p><strong>Ticket Number:</strong> ${ticketNumber}</p>
            <p><strong>Category:</strong> ${category}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Description:</strong></p>
            <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; margin-left: 0; white-space: pre-wrap;">${description}</blockquote>
            <p>Please login to the admin dashboard to view and reply to this ticket.</p>
          </div>
        `
      }).catch(err => console.error("Failed to send admin notification:", err));

      // 2. Acknowledge Learner
      await emailService.sendEmail({
        to: user.email,
        subject: `Support Ticket Received: ${ticketNumber}`,
        text: `Dear ${user.full_name},\n\nWe have received your support ticket request (${ticketNumber}).\nOur team will review your issue and get back to you shortly.\n\nTicket Details:\nSubject: ${subject}\nCategory: ${category}\n\nBest Regards,\nTertiary Infotech Academy`,
        html: `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
            <p>Dear ${user.full_name},</p>
            <p>We have received your support ticket request (<strong>${ticketNumber}</strong>).</p>
            <p>Our team will review your issue and get back to you shortly.</p>
            <h4>Ticket Details:</h4>
            <ul>
              <li><strong>Subject:</strong> ${subject}</li>
              <li><strong>Category:</strong> ${category}</li>
            </ul>
            <p>Best Regards,<br>Tertiary Infotech Academy</p>
          </div>
        `
      }).catch(err => console.error("Failed to send learner acknowledgement:", err));
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
