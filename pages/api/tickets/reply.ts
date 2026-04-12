import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
