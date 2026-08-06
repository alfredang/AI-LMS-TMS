import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { ticketId } = req.query;

    if (!ticketId) {
      return res.status(400).json({ success: false, message: 'ticketId is required' });
    }

    // Fetch ticket with learner info
    const ticketResult = await pool.query(
      `SELECT st.*, au.full_name AS learner_name, au.email AS learner_email
       FROM support_ticket st
       JOIN app_user au ON st.user_id = au.id
       WHERE st.id = $1`,
      [ticketId]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Fetch replies with user names
    const repliesResult = await pool.query(
      `SELECT str.*, au.full_name AS user_name
       FROM support_ticket_reply str
       JOIN app_user au ON str.user_id = au.id
       WHERE str.ticket_id = $1
       ORDER BY str.created_at ASC`,
      [ticketId]
    );

    res.status(200).json({
      success: true,
      data: {
        ticket: ticketResult.rows[0],
        replies: repliesResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching ticket detail:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
